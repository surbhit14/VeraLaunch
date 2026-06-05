/**
 * scripts/test-vesting-e2e.ts
 *
 * Full end-to-end proof of the VestingVault AI pipeline using the CORRECT
 * Parse Website usage (domain search). Creates a schedule with one milestone
 * whose claim is a verifiable, web-searchable fact, then claims it and waits
 * for the 2-step agent pipeline (Parse → LLM) to release the tokens.
 *
 * Usage:
 *   npx hardhat run scripts/test-vesting-e2e.ts --network somnia
 */

import hre from "hardhat";
import { parseEther, formatEther } from "viem";
import * as fs from "fs";
import * as path from "path";

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const STATUS = ["PENDING", "VERIFYING", "PASSED", "FAILED"];

async function main() {
  const dep = JSON.parse(fs.readFileSync(path.join(__dirname, "../deployments/testnet.json"), "utf-8"));
  const [signer] = await hre.viem.getWalletClients();
  const publicClient = await hre.viem.getPublicClient();
  const me = signer.account.address;

  const vault = await hre.viem.getContractAt("VestingVault", dep.VestingVault as `0x${string}`);
  const token = await hre.viem.getContractAt("MockERC20",    dep.MockERC20    as `0x${string}`);

  console.log("═══════════════════════════════════════════════════════════");
  console.log("  VestingVault — End-to-End AI Pipeline Test");
  console.log("═══════════════════════════════════════════════════════════");
  console.log(`  VestingVault : ${dep.VestingVault}`);
  console.log(`  Beneficiary  : ${me}`);
  const bal = await publicClient.getBalance({ address: me });
  console.log(`  STT balance  : ${formatEther(bal)} STT`);

  // A milestone whose claim is a verifiable, web-searchable fact → should PASS.
  // evidenceUrl is treated as a DOMAIN; description is used as the search query.
  const MILESTONE = {
    description: "Ethereum is a blockchain that supports smart contracts written in the Solidity programming language",
    evidenceUrl: "ethereum.org",
    unlock: parseEther("100"),
    deadline: BigInt(Math.floor(Date.now() / 1000)) + BigInt(180 * 24 * 3600),
  };
  const TOTAL = MILESTONE.unlock;

  // ── Setup: mint + approve ────────────────────────────────────────────────
  console.log("\n── Setup ──────────────────────────────────────────────────");
  await token.write.mint([me, TOTAL], { account: signer.account });
  await sleep(3000);
  await token.write.approve([dep.VestingVault as `0x${string}`, TOTAL], { account: signer.account });
  await sleep(3000);
  console.log(`  Minted + approved ${formatEther(TOTAL)} DEMO`);

  // ── Create schedule ──────────────────────────────────────────────────────
  const createTx = await vault.write.createSchedule(
    [dep.MockERC20 as `0x${string}`, TOTAL, me, [{
      description:  MILESTONE.description,
      evidenceUrl:  MILESTONE.evidenceUrl,
      unlockAmount: MILESTONE.unlock,
      deadline:     MILESTONE.deadline,
    }]],
    { account: signer.account }
  );
  await sleep(4000);
  const scheduleId = (await vault.read.nextScheduleId()) as bigint - 1n;
  console.log(`  Created schedule #${scheduleId} (tx ${createTx.slice(0, 18)}…)`);
  console.log(`  Milestone: "${MILESTONE.description}"`);
  console.log(`  Evidence domain: ${MILESTONE.evidenceUrl}`);

  const balBefore = await token.read.balanceOf([me]) as bigint;

  // ── Claim milestone (triggers 2-step AI pipeline) ─────────────────────────
  console.log("\n── Claiming milestone (0.80 STT) ───────────────────────────");
  const claimTx = await vault.write.claimMilestone(
    [scheduleId, 0n],
    { account: signer.account, value: parseEther("0.80") }
  );
  console.log(`  claimMilestone tx: ${claimTx}`);
  await sleep(4000);

  let m: any = await vault.read.getMilestone([scheduleId, 0n]);
  console.log(`  Milestone status: ${STATUS[Number(m.status ?? m[4])]} (expect VERIFYING)`);

  // ── Poll for terminal state ───────────────────────────────────────────────
  console.log("\n── Waiting for AI pipeline (Parse → LLM), up to 10 min ─────");
  const start = Date.now();
  let finalStatus = -1;
  while (Date.now() - start < 10 * 60 * 1000) {
    await sleep(10000);
    const elapsed = Math.floor((Date.now() - start) / 1000);
    m = await vault.read.getMilestone([scheduleId, 0n]);
    const st = Number(m.status ?? m[4]);
    process.stdout.write(`\r  [${elapsed}s] milestone status = ${STATUS[st]}        `);
    if (st === 2 || st === 3) { finalStatus = st; process.stdout.write("\n"); break; }
  }

  // ── Result ─────────────────────────────────────────────────────────────────
  console.log("\n═══════════════════════════════════════════════════════════");
  console.log("  RESULT");
  console.log("═══════════════════════════════════════════════════════════");
  if (finalStatus === 2) {
    const balAfter = await token.read.balanceOf([me]) as bigint;
    const unlocked = (await vault.read.getUnlocked([scheduleId])) as bigint;
    console.log(`  ✅ MILESTONE PASSED — AI verified the claim end-to-end`);
    console.log(`     unlockedAmount : ${formatEther(unlocked)} DEMO`);
    console.log(`     tokens received: ${formatEther(balAfter - balBefore)} DEMO`);
  } else if (finalStatus === 3) {
    console.log(`  ❌ MILESTONE FAILED — check AgentDebug event for the validator bytes`);
    console.log(`     (the pipeline ran but returned FAIL or an agent error)`);
  } else {
    console.log(`  ⏱ No terminal state within 10 min — still VERIFYING (testnet latency)`);
  }
  console.log("═══════════════════════════════════════════════════════════");
}

main().catch(e => { console.error(e); process.exit(1); });
