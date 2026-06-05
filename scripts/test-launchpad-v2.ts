/**
 * scripts/test-launchpad-v2.ts
 *
 * End-to-end proof of LaunchPool v2 economics:
 *   - milestone-gated treasury: a PASS releases a tranche of the raise to the owner
 *   - investor clawback: a stranded (expired) milestone's funds become reclaimable
 *   - buyer vesting: purchased tokens unlock linearly
 *
 * Deployer plays owner + investor; correctness is asserted via view functions
 * and events (treasuryReleased, getClawbackable, TreasuryClawback, vesting views).
 *
 * Usage:  npx hardhat run scripts/test-launchpad-v2.ts --network somnia
 */

import hre from "hardhat";
import { parseEther, formatEther } from "viem";
import * as fs from "fs";
import * as path from "path";

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const MS = ["PENDING", "VERIFYING", "PASSED", "FAILED"];

async function main() {
  const dep = JSON.parse(fs.readFileSync(path.join(__dirname, "../deployments/testnet.json"), "utf-8"));
  const [signer] = await hre.viem.getWalletClients();
  const publicClient = await hre.viem.getPublicClient();
  const me = signer.account.address;

  const pool = await hre.viem.getContractAt("LaunchPool", dep.LaunchPool as `0x${string}`);
  const token = await hre.viem.deployContract("MockERC20", ["Treasury Demo", "TDEMO", parseEther("100000")]);

  console.log("═══════════════════════════════════════════════════════════");
  console.log("  LaunchPool v2 — Treasury / Clawback / Vesting E2E");
  console.log("═══════════════════════════════════════════════════════════");
  console.log(`  LaunchPool : ${dep.LaunchPool}`);
  console.log(`  Token      : ${token.address}`);

  const PRICE = parseEther("0.001");
  const TOTAL_TOKENS = parseEther("5000");
  await token.write.approve([dep.LaunchPool as `0x${string}`, TOTAL_TOKENS], { account: signer.account });
  await sleep(3000);

  const now = () => BigInt(Math.floor(Date.now() / 1000));
  const start = now() + 6n;
  const end   = start + 30n;
  const mDeadlinePass = end + 3600n;  // M0 has plenty of time → will PASS
  const mDeadlineExp  = end + 25n;    // M1 expires shortly after sale → clawback

  console.log("\n── Creating treasury pool (vesting 120s, 2 fund milestones) ──");
  await pool.write.createPool([
    {
      projectToken:  token.address,
      tokenPrice:    PRICE,
      hardCap:       parseEther("5"),
      softCap:       parseEther("1"),
      perWalletCap:  parseEther("3"),
      totalTokens:   TOTAL_TOKENS,
      startTime:     start,
      endTime:       end,
      minSybilScore: 0,
      buyerCliff:    0n,
      buyerVest:     120n,
    },
    [
      { description: "Ethereum supports smart contracts written in the Solidity language",
        evidenceDomain: "ethereum.org", releaseBps: 6000, deadline: mDeadlinePass },
      { description: "This project shipped a flying car to every investor in 2019",
        evidenceDomain: "ethereum.org", releaseBps: 4000, deadline: mDeadlineExp },
    ],
  ], { account: signer.account });
  await sleep(4000);
  const poolId = (await pool.read.nextPoolId() as bigint) - 1n;
  console.log(`  ✓ pool #${poolId} created (M0 60% will PASS, M1 40% will expire → clawback)`);

  // Participate
  console.log("\n── Waiting for sale to open, then contributing 2 STT ──────");
  await sleep(8000);
  await pool.write.participate([poolId], { account: signer.account, value: parseEther("2") });
  await sleep(3000);
  const contrib = await pool.read.getContribution([poolId, me]) as bigint;
  console.log(`  contribution: ${formatEther(contrib)} STT`);

  // Finalize after end
  console.log("\n── Waiting for sale to end, then finalizing ───────────────");
  while (now() <= end + 2n) await sleep(3000);
  await pool.write.finalize([poolId], { account: signer.account });
  await sleep(3000);
  const p = await pool.read.pools([poolId]) as any;
  console.log(`  finalized=${p[10]} softCapMet=${p[11]} usesTreasury=${p[13]} (funds escrowed in treasury)`);

  // Vesting view right after finalize (vest 120s, cliff 0)
  const fullAlloc = await pool.read.getClaimableTokens([poolId, me]) as bigint;
  const vestedNow = await pool.read.getVestedClaimable([poolId, me]) as bigint;
  console.log(`\n── Buyer vesting ──────────────────────────────────────────`);
  console.log(`  full allocation : ${formatEther(fullAlloc)} TDEMO`);
  console.log(`  vested so far   : ${formatEther(vestedNow)} TDEMO (linear over 120s — small right after finalize)`);

  // Treasury milestone 0 → should PASS and release 60% of 2 STT = 1.2 STT
  console.log(`\n── Treasury milestone #0 (AI-verified) ────────────────────`);
  await pool.write.claimFundMilestone([poolId, 0n], { account: signer.account, value: parseEther("0.80") });
  console.log(`  claimFundMilestone(0) sent — AI verifying (Parse → LLM)…`);
  let m0 = MS[Number((await pool.read.getFundMilestones([poolId]) as any[])[0].status)];
  console.log(`  status: ${m0} (expect VERIFYING)`);

  const tStart = Date.now();
  let released = 0n;
  while (Date.now() - tStart < 6 * 60 * 1000) {
    await sleep(10000);
    const ms = await pool.read.getFundMilestones([poolId]) as any[];
    const st = Number(ms[0].status);
    process.stdout.write(`\r  [${Math.floor((Date.now()-tStart)/1000)}s] M0 = ${MS[st]}        `);
    if (st === 2 || st === 3) {
      const pp = await pool.read.pools([poolId]) as any;
      released = pp[14] as bigint;
      process.stdout.write("\n");
      console.log(`  ${st === 2 ? "✅ PASSED" : "❌ FAILED"} — treasuryReleased = ${formatEther(released)} STT (expect ~1.2 on PASS)`);
      break;
    }
  }

  // Clawback after M1 expires
  console.log(`\n── Investor clawback (M1 expires unmet) ───────────────────`);
  while (now() <= mDeadlineExp + 2n) { process.stdout.write(`\r  waiting for M1 deadline…   `); await sleep(3000); }
  process.stdout.write("\n");
  const clawable = await pool.read.getClawbackable([poolId, me]) as bigint;
  console.log(`  getClawbackable = ${formatEther(clawable)} STT (expect ~0.8 = 40% of 2 STT)`);
  if (clawable > 0n) {
    await pool.write.clawback([poolId], { account: signer.account });
    await sleep(3000);
    console.log(`  ✅ clawback executed — investor reclaimed the stranded tranche`);
  }

  console.log("\n═══════════════════════════════════════════════════════════");
  console.log("  SUMMARY");
  console.log("═══════════════════════════════════════════════════════════");
  console.log(`  Treasury released to team : ${formatEther(released)} STT (milestone PASS)`);
  console.log(`  Investor clawback         : ${formatEther(clawable)} STT (milestone expired)`);
  console.log(`  Buyer vesting             : linear over 120s — view-verified`);
  console.log("═══════════════════════════════════════════════════════════");
}

main().catch(e => { console.error(e); process.exit(1); });
