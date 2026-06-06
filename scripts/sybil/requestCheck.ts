/**
 * scripts/sybil/requestCheck.ts
 *
 * Submits a wallet address for Sybil attestation and polls until the
 * score is stored on-chain.
 *
 * Usage:
 *   WALLET=0xYourWalletAddress npx hardhat run scripts/sybil/requestCheck.ts --network somnia
 *
 * The two-step agent pipeline takes ~30-120 seconds:
 *   Step 1: LLM Parse Website scrapes the block explorer page
 *   Step 2: LLM Inference scores wallet uniqueness 0-100
 */

import hre from "hardhat";
import { parseEther, formatEther } from "viem";
import * as fs from "fs";
import * as path from "path";

async function main() {
  const wallet = (process.env.WALLET ?? "") as `0x${string}`;
  if (!wallet || !wallet.startsWith("0x")) {
    throw new Error(
      "Set WALLET env var: WALLET=0x... npx hardhat run scripts/sybil/requestCheck.ts --network somnia"
    );
  }

  const deploymentsPath = path.join(__dirname, "../../deployments/testnet.json");
  const deployments = JSON.parse(fs.readFileSync(deploymentsPath, "utf-8"));

  const [signer] = await hre.viem.getWalletClients();
  const publicClient = await hre.viem.getPublicClient();

  const sybilRegistry = await hre.viem.getContractAt(
    "SybilRegistry",
    deployments.SybilRegistry
  );

  console.log("─────────────────────────────────────────────");
  console.log("VeraLaunch — Sybil Attestation Request");
  console.log("─────────────────────────────────────────────");
  console.log(`SybilRegistry : ${deployments.SybilRegistry}`);
  console.log(`Wallet        : ${wallet}`);
  console.log(`Signer        : ${signer.account.address}`);
  console.log("─────────────────────────────────────────────\n");

  // Check if already verified
  const existing = await sybilRegistry.read.attestations([wallet]);
  if (existing[3]) {
    // exists = true
    const expiresAt = new Date(Number(existing[2]) * 1000);
    if (expiresAt > new Date()) {
      console.log(`⚠️  Wallet already has a valid attestation:`);
      console.log(`   Score    : ${existing[0]}/100`);
      console.log(`   Expires  : ${expiresAt.toISOString()}`);
      console.log("\nProceed anyway? Set FORCE=true to re-attest.");
      if (!process.env.FORCE) return;
    }
  }

  const TOTAL_DEPOSIT = parseEther("0.2");

  const signerBalance = await publicClient.getBalance({
    address: signer.account.address,
  });
  if (signerBalance < TOTAL_DEPOSIT) {
    throw new Error(
      `Insufficient STT balance. Need 0.2 STT, have ${formatEther(signerBalance)} STT`
    );
  }

  console.log(`Sending requestAttestation with 0.2 STT deposit...`);

  const txHash = await sybilRegistry.write.requestAttestation([wallet], {
    value: TOTAL_DEPOSIT,
    account: signer.account,
  });

  console.log(`Transaction: ${txHash}`);
  console.log("\nWaiting for agent pipeline to complete (~30-120 seconds)...");
  console.log("Pipeline: Parse Website (explorer page) → LLM Inference (score 0-100)\n");

  // Poll every 5 seconds for up to 3 minutes
  const MAX_POLLS = 36;
  for (let i = 1; i <= MAX_POLLS; i++) {
    await sleep(5000);

    const attestation = await sybilRegistry.read.attestations([wallet]);
    const exists = attestation[3];

    if (exists) {
      const score     = attestation[0];
      const timestamp = new Date(Number(attestation[1]) * 1000);
      const expiresAt = new Date(Number(attestation[2]) * 1000);

      console.log("\n✅ Attestation stored!");
      console.log("─────────────────────────────────────────────");
      console.log(`Wallet   : ${wallet}`);
      console.log(`Score    : ${score}/100`);
      console.log(`Stored   : ${timestamp.toISOString()}`);
      console.log(`Expires  : ${expiresAt.toISOString()}`);
      console.log("─────────────────────────────────────────────");

      if (score >= 60) {
        console.log(`\n🟢 Score ${score} ≥ 60 — wallet can participate in pools with minSybilScore ≤ ${score}`);
      } else {
        console.log(`\n🔴 Score ${score} < 60 — wallet may be blocked from pools with strict Sybil thresholds`);
      }
      return;
    }

    process.stdout.write(`\r⏳ Polling [${i}/${MAX_POLLS}] — ${i * 5}s elapsed...`);
  }

  console.log(
    "\n⚠️  Timed out after 3 minutes. The pipeline may still be running — check events with: npm run monitor"
  );
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
