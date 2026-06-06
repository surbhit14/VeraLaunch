/**
 * scripts/launch/claimOrRefund.ts
 *
 * After a pool is finalized:
 *   - If IDO succeeded (soft cap met): claims project tokens for the signer
 *   - If IDO failed (soft cap missed): claims a full STT refund
 *
 * Usage:
 *   POOL_ID=0 npx hardhat run scripts/launch/claimOrRefund.ts --network somnia
 */

import hre from "hardhat";
import { formatEther } from "viem";
import * as fs from "fs";
import * as path from "path";

async function main() {
  const poolId = BigInt(process.env.POOL_ID ?? "0");

  const deploymentsPath = path.join(__dirname, "../../deployments/testnet.json");
  const deployments = JSON.parse(fs.readFileSync(deploymentsPath, "utf-8"));

  const [signer]    = await hre.viem.getWalletClients();
  const launchPool  = await hre.viem.getContractAt("LaunchPool", deployments.LaunchPool);

  console.log("─────────────────────────────────────────────");
  console.log("VeraLaunch — Claim Tokens / Refund");
  console.log("─────────────────────────────────────────────");
  console.log(`LaunchPool   : ${deployments.LaunchPool}`);
  console.log(`Pool ID      : ${poolId}`);
  console.log(`Signer       : ${signer.account.address}`);
  console.log("─────────────────────────────────────────────\n");

  const pool         = await launchPool.read.pools([poolId]);
  const contribution = await launchPool.read.getContribution([poolId, signer.account.address]);

  console.log("Pool status:");
  console.log(`  Finalized   : ${pool[11]}`);
  console.log(`  Soft cap met: ${pool[12]}`);
  console.log(`  Total raised: ${formatEther(pool[9])} STT`);
  console.log();
  console.log(`My contribution: ${formatEther(contribution)} STT`);

  if (!pool[11]) {
    console.log("⚠️  Pool not yet finalized. Ask the pool owner to finalize first.");
    return;
  }

  if (contribution === 0n) {
    console.log("⚠️  No contribution found for this wallet in this pool.");
    return;
  }

  if (pool[12]) {
    // Soft cap met — claim tokens
    const claimable = await launchPool.read.getClaimableTokens([poolId, signer.account.address]);
    console.log(`\nIDO succeeded! Claiming ${formatEther(claimable)} project tokens...`);

    const txHash = await launchPool.write.claimTokens([poolId], {
      account: signer.account,
    });
    console.log(`Transaction: ${txHash}`);
    await sleep(3000);

    console.log("\n✅ Tokens claimed!");
    console.log(`Received: ${formatEther(claimable)} project tokens`);
  } else {
    // Soft cap missed — refund
    console.log(`\nIDO failed (soft cap not met). Claiming refund of ${formatEther(contribution)} STT...`);

    const txHash = await launchPool.write.refund([poolId], {
      account: signer.account,
    });
    console.log(`Transaction: ${txHash}`);
    await sleep(3000);

    console.log("\n✅ Refund claimed!");
    console.log(`Received: ${formatEther(contribution)} STT`);
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
