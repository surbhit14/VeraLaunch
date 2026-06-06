/**
 * scripts/launch/finalizePool.ts
 *
 * Finalizes an IDO pool after its endTime has passed.
 * Only the pool owner can call this.
 *
 * Usage:
 *   POOL_ID=0 npx hardhat run scripts/launch/finalizePool.ts --network somnia
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
  console.log("VeraLaunch — Finalize Pool");
  console.log("─────────────────────────────────────────────");
  console.log(`LaunchPool : ${deployments.LaunchPool}`);
  console.log(`Pool ID    : ${poolId}`);
  console.log(`Signer     : ${signer.account.address}`);
  console.log("─────────────────────────────────────────────\n");

  const pool  = await launchPool.read.pools([poolId]);
  const owner = await launchPool.read.poolOwner([poolId]);

  console.log("Pool summary:");
  console.log(`  Token        : ${pool[0]}`);
  console.log(`  Raised       : ${formatEther(pool[9])} STT`);
  console.log(`  Soft cap     : ${formatEther(pool[3])} STT`);
  console.log(`  Hard cap     : ${formatEther(pool[2])} STT`);
  console.log(`  End time     : ${new Date(Number(pool[8]) * 1000).toISOString()}`);
  console.log(`  Finalized    : ${pool[11]}`);
  console.log(`  Owner        : ${owner}`);
  console.log();

  if (pool[11]) {
    console.log("⚠️  Pool already finalized.");
    return;
  }

  const now = BigInt(Math.floor(Date.now() / 1000));
  if (now <= pool[8]) {
    const remaining = Number(pool[8] - now);
    console.log(`⚠️  Pool not ended yet. Ends in ${Math.ceil(remaining / 60)} minutes.`);
    return;
  }

  if (signer.account.address.toLowerCase() !== owner.toLowerCase()) {
    throw new Error(`Only the pool owner (${owner}) can finalize.`);
  }

  const softCapMet = pool[9] >= pool[3];
  console.log(
    softCapMet
      ? `✓ Soft cap met (${formatEther(pool[9])} / ${formatEther(pool[3])} STT) — IDO succeeded`
      : `✗ Soft cap NOT met (${formatEther(pool[9])} / ${formatEther(pool[3])} STT) — IDO failed, refunds enabled`
  );

  console.log("\nFinalizing...");
  const txHash = await launchPool.write.finalize([poolId], {
    account: signer.account,
  });
  console.log(`Transaction: ${txHash}`);
  await sleep(3000);

  const updatedPool = await launchPool.read.pools([poolId]);
  console.log("\n✅ Pool finalized!");
  console.log("─────────────────────────────────────────────");
  console.log(`Soft cap met : ${updatedPool[12]}`);
  console.log(`Total raised : ${formatEther(updatedPool[9])} STT`);

  if (updatedPool[12]) {
    console.log("\nParticipants can now claim tokens:");
    console.log(`  POOL_ID=${poolId} npm run launch:claim`);
  } else {
    console.log("\nParticipants can now claim refunds:");
    console.log(`  POOL_ID=${poolId} npm run launch:claim`);
  }
  console.log("─────────────────────────────────────────────");
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
