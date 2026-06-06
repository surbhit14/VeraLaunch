/**
 * scripts/launch/participate.ts
 *
 * Contributes STT to an active IDO pool.
 * Will revert if the signer does not have a valid Sybil attestation.
 *
 * Usage:
 *   POOL_ID=0 AMOUNT_STT=1 npx hardhat run scripts/launch/participate.ts --network somnia
 */

import hre from "hardhat";
import { parseEther, formatEther } from "viem";
import * as fs from "fs";
import * as path from "path";

async function main() {
  const poolId    = BigInt(process.env.POOL_ID    ?? "0");
  const amountSTT = process.env.AMOUNT_STT        ?? "1";

  const deploymentsPath = path.join(__dirname, "../../deployments/testnet.json");
  const deployments = JSON.parse(fs.readFileSync(deploymentsPath, "utf-8"));

  const [signer]      = await hre.viem.getWalletClients();
  const publicClient  = await hre.viem.getPublicClient();
  const launchPool    = await hre.viem.getContractAt("LaunchPool", deployments.LaunchPool);
  const sybilRegistry = await hre.viem.getContractAt("SybilRegistry", deployments.SybilRegistry);

  console.log("─────────────────────────────────────────────");
  console.log("VeraLaunch — Participate in IDO");
  console.log("─────────────────────────────────────────────");
  console.log(`LaunchPool   : ${deployments.LaunchPool}`);
  console.log(`Pool ID      : ${poolId}`);
  console.log(`Contributor  : ${signer.account.address}`);
  console.log(`Amount       : ${amountSTT} STT`);
  console.log("─────────────────────────────────────────────\n");

  // Check pool status
  const pool = await launchPool.read.pools([poolId]);
  const isActive = await launchPool.read.isActive([poolId]);

  console.log("Pool info:");
  console.log(`  Token price     : ${formatEther(pool[1])} STT/token`);
  console.log(`  Hard cap        : ${formatEther(pool[2])} STT`);
  console.log(`  Soft cap        : ${formatEther(pool[3])} STT`);
  console.log(`  Per-wallet cap  : ${formatEther(pool[4])} STT`);
  console.log(`  Total raised    : ${formatEther(pool[9])} STT`);
  console.log(`  Min Sybil score : ${pool[10]}/100`);
  console.log(`  Active          : ${isActive}`);
  console.log();

  if (!isActive) {
    const now = BigInt(Math.floor(Date.now() / 1000));
    if (now < pool[7]) {
      console.log(`⚠️  Pool has not started yet. Starts at: ${new Date(Number(pool[7]) * 1000).toISOString()}`);
    } else {
      console.log("⚠️  Pool is not active (ended or finalized).");
    }
    return;
  }

  // Check Sybil attestation
  const attestation = await sybilRegistry.read.attestations([signer.account.address]);
  const attestationExists = attestation[3];

  console.log("Sybil attestation check:");
  if (!attestationExists) {
    console.log("  ❌ No attestation found.");
    console.log(`\n  Run first: WALLET=${signer.account.address} npm run sybil:check`);
    return;
  }

  const score     = attestation[0];
  const expiresAt = new Date(Number(attestation[2]) * 1000);
  const valid     = expiresAt > new Date() && score >= pool[10];

  console.log(`  Score     : ${score}/100`);
  console.log(`  Expires   : ${expiresAt.toISOString()}`);
  console.log(`  Required  : ≥ ${pool[10]}/100`);

  if (!valid) {
    if (score < pool[10]) {
      console.log(`\n  ❌ Score ${score} is below pool minimum ${pool[10]}. This pool requires higher verified uniqueness.`);
    } else {
      console.log(`\n  ❌ Attestation has expired. Re-run: WALLET=${signer.account.address} npm run sybil:check`);
    }
    return;
  }
  console.log(`  ✓ Attestation valid\n`);

  // Check STT balance
  const amount  = parseEther(amountSTT);
  const balance = await publicClient.getBalance({ address: signer.account.address });

  if (balance < amount) {
    throw new Error(`Insufficient STT. Need ${amountSTT} STT, have ${formatEther(balance)} STT`);
  }

  // Check existing contribution
  const existingContrib = await launchPool.read.getContribution([poolId, signer.account.address]);
  const newContrib = existingContrib + amount;
  if (newContrib > pool[4]) {
    throw new Error(
      `Would exceed per-wallet cap. Current: ${formatEther(existingContrib)} STT, ` +
      `adding: ${amountSTT} STT, cap: ${formatEther(pool[4])} STT`
    );
  }

  console.log(`Sending participate() with ${amountSTT} STT...`);

  const txHash = await launchPool.write.participate([poolId], {
    value:   amount,
    account: signer.account,
  });

  console.log(`Transaction: ${txHash}`);
  await sleep(3000);

  const updatedPool     = await launchPool.read.pools([poolId]);
  const myContribution  = await launchPool.read.getContribution([poolId, signer.account.address]);
  const claimable       = await launchPool.read.getClaimableTokens([poolId, signer.account.address]);

  console.log("\n✅ Participation recorded!");
  console.log("─────────────────────────────────────────────");
  console.log(`My contribution  : ${formatEther(myContribution)} STT`);
  console.log(`Claimable tokens : ${formatEther(claimable)} tokens (if IDO succeeds)`);
  console.log(`Pool total raised: ${formatEther(updatedPool[9])} / ${formatEther(updatedPool[2])} STT`);
  console.log("─────────────────────────────────────────────");
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
