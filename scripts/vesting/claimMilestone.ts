/**
 * scripts/vesting/claimMilestone.ts
 *
 * Triggers AI verification for a PENDING milestone in VestingVault.
 * Polls until the milestone is resolved as PASSED or FAILED.
 *
 * Usage:
 *   SCHEDULE_ID=0 MILESTONE_INDEX=0 npx hardhat run scripts/vesting/claimMilestone.ts --network somnia
 *
 * The two-step pipeline takes ~30-120 seconds:
 *   Step 1: LLM Parse Website scrapes the evidence URL
 *   Step 2: LLM Inference evaluates evidence vs milestone description → PASS/FAIL
 */

import hre from "hardhat";
import { parseEther, formatEther } from "viem";
import * as fs from "fs";
import * as path from "path";

const STATUS_NAMES = ["PENDING", "VERIFYING", "PASSED", "FAILED"];

async function main() {
  const scheduleId     = BigInt(process.env.SCHEDULE_ID     ?? "0");
  const milestoneIndex = BigInt(process.env.MILESTONE_INDEX ?? "0");

  const deploymentsPath = path.join(__dirname, "../../deployments/testnet.json");
  const deployments = JSON.parse(fs.readFileSync(deploymentsPath, "utf-8"));

  const [signer] = await hre.viem.getWalletClients();
  const publicClient = await hre.viem.getPublicClient();
  const vestingVault = await hre.viem.getContractAt("VestingVault", deployments.VestingVault);

  console.log("─────────────────────────────────────────────");
  console.log("VeraLaunch — Claim Milestone");
  console.log("─────────────────────────────────────────────");
  console.log(`VestingVault    : ${deployments.VestingVault}`);
  console.log(`Schedule ID     : ${scheduleId}`);
  console.log(`Milestone Index : ${milestoneIndex}`);
  console.log(`Signer          : ${signer.account.address}`);
  console.log("─────────────────────────────────────────────\n");

  // Fetch milestone details
  const milestone = await vestingVault.read.getMilestone([scheduleId, milestoneIndex]);
  const schedule  = await vestingVault.read.schedules([scheduleId]);

  console.log("Milestone details:");
  console.log(`  Description : ${milestone[0]}`);
  console.log(`  Evidence URL: ${milestone[1]}`);
  console.log(`  Unlock amt  : ${formatEther(milestone[2])} tokens`);
  console.log(`  Deadline    : ${new Date(Number(milestone[3]) * 1000).toISOString()}`);
  console.log(`  Status      : ${STATUS_NAMES[milestone[4]]}`);
  console.log();

  if (milestone[4] !== 0) {
    // Not PENDING
    console.log(`⚠️  Milestone is already ${STATUS_NAMES[milestone[4]]}. Only PENDING milestones can be claimed.`);
    return;
  }

  // Verify caller is beneficiary
  if (signer.account.address.toLowerCase() !== schedule[0].toLowerCase()) {
    throw new Error(
      `Signer (${signer.account.address}) is not the schedule beneficiary (${schedule[0]})`
    );
  }

  const TOTAL_DEPOSIT = parseEther("0.8");
  const balance = await publicClient.getBalance({ address: signer.account.address });

  if (balance < TOTAL_DEPOSIT) {
    throw new Error(
      `Insufficient STT balance. Need 0.8 STT, have ${formatEther(balance)} STT`
    );
  }

  console.log("Submitting claimMilestone with 0.8 STT deposit...");

  const txHash = await vestingVault.write.claimMilestone(
    [scheduleId, milestoneIndex],
    {
      value:   TOTAL_DEPOSIT,
      account: signer.account,
    }
  );

  console.log(`Transaction: ${txHash}`);
  console.log("\nWaiting for agent pipeline (~30-120 seconds)...");
  console.log("Pipeline: Parse Website (evidence URL) → LLM Inference (PASS/FAIL)\n");

  // Poll milestone status every 5 seconds for up to 3 minutes
  const MAX_POLLS = 36;
  for (let i = 1; i <= MAX_POLLS; i++) {
    await sleep(5000);

    const updated = await vestingVault.read.getMilestone([scheduleId, milestoneIndex]);
    const status  = updated[4];

    if (status === 2) {
      // PASSED
      const unlocked = await vestingVault.read.getUnlocked([scheduleId]);
      console.log("\n✅ Milestone PASSED!");
      console.log("─────────────────────────────────────────────");
      console.log(`Schedule ID     : ${scheduleId}`);
      console.log(`Milestone       : ${milestoneIndex}`);
      console.log(`Tokens unlocked : ${formatEther(updated[2])} tokens`);
      console.log(`Total unlocked  : ${formatEther(unlocked)} tokens`);
      console.log("─────────────────────────────────────────────");
      return;
    }

    if (status === 3) {
      // FAILED
      console.log("\n❌ Milestone FAILED");
      console.log("─────────────────────────────────────────────");
      console.log("The AI agents determined there was insufficient evidence to pass this milestone.");
      console.log("Options:");
      console.log("  • Update the evidence URL to a more comprehensive source");
      console.log("  • Re-submit once the milestone is genuinely completed");
      console.log("  Note: A FAILED milestone cannot be re-claimed on this schedule.");
      console.log("─────────────────────────────────────────────");
      return;
    }

    process.stdout.write(
      `\r⏳ Status: ${STATUS_NAMES[status]} [${i}/${MAX_POLLS}] — ${i * 5}s elapsed...`
    );
  }

  console.log(
    "\n⚠️  Timed out after 3 minutes. Pipeline may still be running — check with: npm run monitor"
  );
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
