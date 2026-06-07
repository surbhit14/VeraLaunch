/**
 * scripts/keeper.ts
 *
 * VeraLaunch Autonomous Keeper Agent.
 *
 * Runs forever with no human in the loop. Every cycle it DISCOVERS on-chain
 * state and acts on it:
 *   • a sale has ended      → auto-finalizes the pool
 *   • a fund milestone is due → autonomously INVOKES Somnia's consensus AI to
 *                               verify it, releasing escrowed funds on PASS
 *   • a vesting milestone is pending → triggers its AI verification
 * It also watches status transitions and narrates the AI verdicts as they land,
 * so the system visibly operates itself.
 *
 * The keeper signs as the project operator (deployer key). It is idempotent and
 * budget-guarded: it never repeats an action and pauses if STT runs low.
 *
 * Usage:  npx hardhat run scripts/keeper.ts --network somnia
 */

import hre from "hardhat";
import { parseEther, formatEther } from "viem";
import * as fs from "fs";
import * as path from "path";

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const POLL_MS     = 15_000;
const MIN_BALANCE = parseEther("1.5");  // pause actions below this
const AGENT_FEE   = parseEther("0.80"); // per AI milestone verification
const MS = ["PENDING", "VERIFYING", "PASSED", "FAILED"];

function log(kind: string, msg: string) {
  const t = new Date().toLocaleTimeString();
  const tag =
    kind === "discover" ? "🔍" :
    kind === "act"      ? "⚙️ " :
    kind === "ai"       ? "🤖" :
    kind === "ok"       ? "✅" :
    kind === "fail"     ? "❌" :
    kind === "info"     ? "·" : " ";
  console.log(`[${t}] ${tag} ${msg}`);
}

async function main() {
  const dep = JSON.parse(fs.readFileSync(path.join(__dirname, "../deployments/testnet.json"), "utf-8"));
  const [signer] = await hre.viem.getWalletClients();
  const pub = await hre.viem.getPublicClient();
  const me = signer.account.address;
  const lp = await hre.viem.getContractAt("LaunchPool",   dep.LaunchPool   as `0x${string}`);
  const vv = await hre.viem.getContractAt("VestingVault", dep.VestingVault as `0x${string}`);
  const to = dep.TrustOracle ? await hre.viem.getContractAt("TrustOracle", dep.TrustOracle as `0x${string}`) : null;

  console.log("══════════════════════════════════════════════════════════════");
  console.log("  VeraLaunch — Autonomous Keeper Agent");
  console.log("══════════════════════════════════════════════════════════════");
  console.log(`  Operator   : ${me}`);
  console.log(`  LaunchPool : ${dep.LaunchPool}`);
  console.log(`  VestingVault: ${dep.VestingVault}`);
  console.log(`  Poll       : every ${POLL_MS / 1000}s · no human in the loop`);
  console.log("══════════════════════════════════════════════════════════════\n");

  const attempted = new Set<string>();          // one-shot actions tried this session
  const attempts  = new Map<string, number>();  // retryable actions → attempt count
  const lastStatus = new Map<string, number>(); // milestone status, to narrate transitions
  const MAX_TRUST_RETRIES = 4;

  for (;;) {
    try {
      const bal = await pub.getBalance({ address: me });
      const canSpend = bal >= MIN_BALANCE;
      if (!canSpend) log("info", `balance ${formatEther(bal)} STT below ${formatEther(MIN_BALANCE)} — monitoring only`);

      const now = BigInt(Math.floor(Date.now() / 1000));

      // ── LaunchPool: finalize ended sales, verify due fund milestones ──────
      const poolCount = Number(await lp.read.nextPoolId());
      for (let i = 0; i < poolCount; i++) {
        const p = await lp.read.pools([BigInt(i)]) as any;
        const owner = await lp.read.poolOwner([BigInt(i)]) as string;
        const isOwner = owner.toLowerCase() === me.toLowerCase();

        const endTime = p[7] as bigint, totalRaised = p[8] as bigint;
        const finalized = p[10] as boolean, softCapMet = p[11] as boolean, usesTreasury = p[15] as boolean;

        // auto-finalize — PERMISSIONLESS: the keeper finalizes ANY ended sale,
        // not just its own. This is the protocol being operated by an open keeper.
        if (!finalized && now > endTime && totalRaised > 0n) {
          const key = `final-${i}`;
          if (!attempted.has(key) && canSpend) {
            attempted.add(key);
            log("discover", `pool #${i} sale ended with ${formatEther(totalRaised)} STT raised → finalizing autonomously`);
            try { await lp.write.finalize([BigInt(i)], { account: signer.account }); log("ok", `pool #${i} finalized`); }
            catch (e: any) { log("fail", `finalize #${i}: ${e.shortMessage ?? e.message}`); }
          }
          continue;
        }

        // auto-verify treasury milestones (the owner triggers these — they decide
        // when a milestone is ready and pay the agent fee), + narrate verdicts
        if (isOwner && finalized && softCapMet && usesTreasury) {
          const ms = await lp.read.getFundMilestones([BigInt(i)]) as any[];
          for (let j = 0; j < ms.length; j++) {
            const st = Number(ms[j].status ?? ms[j][4]);
            const deadline = (ms[j].deadline ?? ms[j][3]) as bigint;
            const desc = (ms[j].description ?? ms[j][0]) as string;
            const mkey = `lp-${i}-${j}`;

            // narrate AI verdicts as they land
            const prev = lastStatus.get(mkey);
            if (prev === 1 && st === 2) log("ai", `pool #${i} milestone ${j} — Somnia AI returned PASS → escrowed funds released`);
            if (prev === 1 && st === 3) log("ai", `pool #${i} milestone ${j} — Somnia AI returned FAIL → funds stay locked for clawback`);
            lastStatus.set(mkey, st);

            // autonomously invoke verification for due, pending milestones
            if (st === 0 && now <= deadline && !attempted.has(mkey) && canSpend) {
              attempted.add(mkey);
              log("discover", `pool #${i} milestone ${j} due: "${desc.slice(0, 48)}…"`);
              log("act", `invoking Somnia consensus AI to verify (0.8 STT)`);
              try {
                await lp.write.claimFundMilestone([BigInt(i), BigInt(j)], { account: signer.account, value: AGENT_FEE });
                log("ok", `pool #${i} milestone ${j} → VERIFYING (agents working)`);
              } catch (e: any) { log("fail", `claim #${i}/${j}: ${e.shortMessage ?? e.message}`); }
            }
          }
        }
      }

      // ── TrustOracle: autonomously score registered projects ──────────────
      if (to) {
        for (let i = 0; i < poolCount; i++) {
          const pr = await to.read.getProject([BigInt(i)]) as any;
          const tstatus = Number(pr.status ?? pr[3]);        // 1=REGISTERED 2=SCORING 3=SCORED 4=FAILED
          const tscore  = Number(pr.score ?? pr[2]);
          const tkey = `trust-${i}`;
          const prev = lastStatus.get(tkey);
          if (prev === 2 && tstatus === 3) log("ai", `project pool #${i} — Trust AI scored it ${tscore}/100`);
          lastStatus.set(tkey, tstatus);

          // score registered/failed/zero projects; retry (web-scrape is noisy on a single validator)
          const needsScore = tstatus === 1 || tstatus === 4 || (tstatus === 3 && tscore === 0);
          const tries = attempts.get(tkey) ?? 0;
          if (needsScore && tries < MAX_TRUST_RETRIES && canSpend) {
            attempts.set(tkey, tries + 1);
            const name = (pr.name ?? pr[0]) as string;
            log("discover", `project "${name}" (pool #${i}) needs a trust score → invoking Trust AI (0.8 STT)${tries > 0 ? ` [retry ${tries}]` : ""}`);
            try {
              await to.write.requestTrustScore([BigInt(i)], { account: signer.account, value: AGENT_FEE });
              log("ok", `pool #${i} trust scoring → in progress`);
            } catch (e: any) { log("fail", `trust #${i}: ${e.shortMessage ?? e.message}`); }
          }
        }
      }

      // ── VestingVault: trigger pending milestone verifications ─────────────
      const schedCount = Number(await vv.read.nextScheduleId());
      for (let i = 0; i < schedCount; i++) {
        const s = await vv.read.schedules([BigInt(i)]) as any;
        const beneficiary = (s.beneficiary ?? s[0]) as string;
        if (beneficiary.toLowerCase() !== me.toLowerCase()) continue;

        const ms = await vv.read.getMilestones([BigInt(i)]) as any[];
        for (let j = 0; j < ms.length; j++) {
          const st = Number(ms[j].status ?? ms[j][4]);
          const deadline = (ms[j].deadline ?? ms[j][3]) as bigint;
          const mkey = `vv-${i}-${j}`;
          const prev = lastStatus.get(mkey);
          if (prev === 1 && st === 2) log("ai", `schedule #${i} milestone ${j} — AI PASS → tokens vested to beneficiary`);
          if (prev === 1 && st === 3) log("ai", `schedule #${i} milestone ${j} — AI FAIL`);
          lastStatus.set(mkey, st);

          if (st === 0 && now <= deadline && !attempted.has(mkey) && canSpend) {
            attempted.add(mkey);
            log("discover", `schedule #${i} milestone ${j} pending → invoking AI verification (0.8 STT)`);
            try {
              await vv.write.claimMilestone([BigInt(i), BigInt(j)], { account: signer.account, value: AGENT_FEE });
              log("ok", `schedule #${i} milestone ${j} → VERIFYING`);
            } catch (e: any) { log("fail", `vesting claim #${i}/${j}: ${e.shortMessage ?? e.message}`); }
          }
        }
      }
    } catch (e: any) {
      log("fail", `cycle error: ${e.shortMessage ?? e.message}`);
    }

    await sleep(POLL_MS);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
