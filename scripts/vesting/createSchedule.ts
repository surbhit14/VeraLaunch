/**
 * scripts/vesting/createSchedule.ts
 *
 * Creates a vesting schedule in VestingVault for a project token.
 * Approves the vault to pull tokens before creating the schedule.
 *
 * Usage:
 *   TOKEN=0x...            (project token address; use MockERC20 for testing)
 *   BENEFICIARY=0x...      (team wallet that receives unlocked tokens)
 *   npx hardhat run scripts/vesting/createSchedule.ts --network somnia
 *
 * Milestone config is defined inline below — edit before running.
 */

import hre from "hardhat";
import { parseEther, formatEther } from "viem";
import * as fs from "fs";
import * as path from "path";

// ── Milestone definition ─────────────────────────────────────────────────────
// IMPORTANT — how the Parse Website agent actually works (verified on testnet):
//   • evidenceUrl is treated as a DOMAIN (e.g. "github.com", "ethereum.org").
//   • The milestone `description` is used as the natural-language SEARCH QUERY.
//   • The agent searches that domain (resolveUrl=true) and an LLM judges PASS/FAIL.
//   • Direct-scraping a specific URL / JSON API does NOT work — use a domain.
//   • Phrase the description as a verifiable claim findable on that domain.
const MILESTONES = [
  {
    description:   "Ethereum supports smart contracts written in the Solidity language",
    evidenceUrl:   "ethereum.org",
    unlockAmountTokens: "100",
    deadlineDaysFromNow: 180,
  },
  {
    description:   "Bitcoin is a decentralized peer-to-peer digital currency",
    evidenceUrl:   "bitcoin.org",
    unlockAmountTokens: "100",
    deadlineDaysFromNow: 365,
  },
  {
    description:   "Somnia is a high-performance EVM-compatible Layer 1 blockchain",
    evidenceUrl:   "somnia.network",
    unlockAmountTokens: "100",
    deadlineDaysFromNow: 270,
  },
];
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  const tokenAddress      = (process.env.TOKEN ?? "")       as `0x${string}`;
  const beneficiaryAddress = (process.env.BENEFICIARY ?? "") as `0x${string}`;

  const deploymentsPath = path.join(__dirname, "../../deployments/testnet.json");
  const deployments = JSON.parse(fs.readFileSync(deploymentsPath, "utf-8"));

  // Fall back to MockERC20 if TOKEN not provided
  const token       = tokenAddress       || (deployments.MockERC20  as `0x${string}`);
  const beneficiary = beneficiaryAddress || (deployments.deployer   as `0x${string}`);

  const [signer] = await hre.viem.getWalletClients();
  const vestingVault = await hre.viem.getContractAt("VestingVault", deployments.VestingVault);
  const tokenContract = await hre.viem.getContractAt("MockERC20", token);

  console.log("─────────────────────────────────────────────");
  console.log("VeraLaunch — Create Vesting Schedule");
  console.log("─────────────────────────────────────────────");
  console.log(`VestingVault : ${deployments.VestingVault}`);
  console.log(`Token        : ${token}`);
  console.log(`Beneficiary  : ${beneficiary}`);
  console.log(`Milestones   : ${MILESTONES.length}`);
  console.log("─────────────────────────────────────────────\n");

  // Build milestone inputs
  const now = BigInt(Math.floor(Date.now() / 1000));
  const DAY = 86400n;

  const milestoneInputs = MILESTONES.map((m) => ({
    description:  m.description,
    evidenceUrl:  m.evidenceUrl,
    unlockAmount: parseEther(m.unlockAmountTokens),
    deadline:     now + DAY * BigInt(m.deadlineDaysFromNow),
  }));

  const totalAmount = milestoneInputs.reduce(
    (sum, m) => sum + m.unlockAmount,
    0n
  );

  console.log(`Total tokens to lock : ${formatEther(totalAmount)} tokens`);
  console.log("Milestones:");
  MILESTONES.forEach((m, i) => {
    console.log(`  [${i}] ${m.unlockAmountTokens} tokens — "${m.description.slice(0, 60)}..."`);
  });
  console.log();

  // Approve VestingVault to pull tokens
  console.log("Step 1: Approving VestingVault to transfer tokens...");
  const approveTx = await tokenContract.write.approve(
    [deployments.VestingVault as `0x${string}`, totalAmount],
    { account: signer.account }
  );
  console.log(`  Approval tx: ${approveTx}`);

  // Wait a couple seconds for indexing
  await sleep(3000);

  // Create schedule
  console.log("\nStep 2: Creating vesting schedule...");
  const createTx = await vestingVault.write.createSchedule(
    [token, totalAmount, beneficiary as `0x${string}`, milestoneInputs],
    { account: signer.account }
  );
  console.log(`  Create tx: ${createTx}`);

  await sleep(4000);

  // Read back the schedule ID (nextScheduleId was incremented)
  const nextId = await vestingVault.read.nextScheduleId();
  const scheduleId = nextId - 1n;

  const schedule  = await vestingVault.read.schedules([scheduleId]);
  const count     = await vestingVault.read.getMilestoneCount([scheduleId]);

  console.log("\n✅ Vesting schedule created!");
  console.log("─────────────────────────────────────────────");
  console.log(`Schedule ID  : ${scheduleId}`);
  console.log(`Beneficiary  : ${schedule[0]}`);
  console.log(`Token        : ${schedule[1]}`);
  console.log(`Total locked : ${formatEther(schedule[2])} tokens`);
  console.log(`Milestones   : ${count}`);
  console.log("─────────────────────────────────────────────");
  console.log(`\nNext: Run 'SCHEDULE_ID=${scheduleId} MILESTONE_INDEX=0 npm run vesting:claim' to verify milestone 0`);
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
