/**
 * scripts/launch/createPool.ts
 *
 * Creates an IDO pool in LaunchPool.
 * Approves the pool contract to pull project tokens before creating.
 *
 * Usage:
 *   TOKEN=0x...   (project token; defaults to MockERC20)
 *   npx hardhat run scripts/launch/createPool.ts --network somnia
 *
 * Pool config is defined inline — edit before running.
 */

import hre from "hardhat";
import { parseEther, formatEther } from "viem";
import * as fs from "fs";
import * as path from "path";

// ── Pool configuration ────────────────────────────────────────────────────────
const POOL_CONFIG = {
  // Token price: 1 STT buys this many tokens (scaled to 1e18)
  // e.g. tokenPrice = 0.001e18 means 1 token costs 0.001 STT
  tokenPriceSTT:      "0.001",   // STT per token

  // Fundraising caps in STT
  hardCapSTT:         "100",     // max 100 STT raised
  softCapSTT:         "10",      // min 10 STT for IDO to succeed

  // Per-wallet contribution cap in STT
  perWalletCapSTT:    "5",

  // Total project tokens to put into the pool
  totalTokens:        "100000",  // 100K tokens

  // IDO timing
  startDelayMinutes:  5,         // starts 5 minutes from deploy
  durationMinutes:    60,        // runs for 60 minutes

  // Minimum Sybil score required to participate (0-100)
  minSybilScore:      60,
};
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  const tokenArg = (process.env.TOKEN ?? "") as `0x${string}`;

  const deploymentsPath = path.join(__dirname, "../../deployments/testnet.json");
  const deployments = JSON.parse(fs.readFileSync(deploymentsPath, "utf-8"));

  const token = tokenArg || (deployments.MockERC20 as `0x${string}`);

  const [signer] = await hre.viem.getWalletClients();
  const launchPool    = await hre.viem.getContractAt("LaunchPool", deployments.LaunchPool);
  const tokenContract = await hre.viem.getContractAt("MockERC20", token);

  const now       = BigInt(Math.floor(Date.now() / 1000));
  const startTime = now + BigInt(POOL_CONFIG.startDelayMinutes * 60);
  const endTime   = startTime + BigInt(POOL_CONFIG.durationMinutes * 60);

  const tokenPrice     = parseEther(POOL_CONFIG.tokenPriceSTT);
  const hardCap        = parseEther(POOL_CONFIG.hardCapSTT);
  const softCap        = parseEther(POOL_CONFIG.softCapSTT);
  const perWalletCap   = parseEther(POOL_CONFIG.perWalletCapSTT);
  const totalTokens    = parseEther(POOL_CONFIG.totalTokens);

  console.log("─────────────────────────────────────────────");
  console.log("VeraLaunch — Create IDO Pool");
  console.log("─────────────────────────────────────────────");
  console.log(`LaunchPool       : ${deployments.LaunchPool}`);
  console.log(`Project token    : ${token}`);
  console.log(`Token price      : ${POOL_CONFIG.tokenPriceSTT} STT per token`);
  console.log(`Hard cap         : ${POOL_CONFIG.hardCapSTT} STT`);
  console.log(`Soft cap         : ${POOL_CONFIG.softCapSTT} STT`);
  console.log(`Per-wallet cap   : ${POOL_CONFIG.perWalletCapSTT} STT`);
  console.log(`Total tokens     : ${POOL_CONFIG.totalTokens}`);
  console.log(`Start            : ${new Date(Number(startTime) * 1000).toISOString()}`);
  console.log(`End              : ${new Date(Number(endTime) * 1000).toISOString()}`);
  console.log(`Min Sybil score  : ${POOL_CONFIG.minSybilScore}/100`);
  console.log("─────────────────────────────────────────────\n");

  // Step 1: Approve LaunchPool to pull tokens
  console.log("Step 1: Approving LaunchPool to transfer project tokens...");
  const approveTx = await tokenContract.write.approve(
    [deployments.LaunchPool as `0x${string}`, totalTokens],
    { account: signer.account }
  );
  console.log(`  Approval tx: ${approveTx}`);
  await sleep(3000);

  // Step 2: Create pool
  console.log("\nStep 2: Creating pool...");
  const createTx = await launchPool.write.createPool(
    [{
      projectToken:  token,
      tokenPrice,
      hardCap,
      softCap,
      perWalletCap,
      totalTokens,
      startTime,
      endTime,
      minSybilScore: POOL_CONFIG.minSybilScore,
      buyerCliff:    0n,
      buyerVest:     0n,
    }, []],
    { account: signer.account }
  );
  console.log(`  Create tx: ${createTx}`);
  await sleep(4000);

  const nextPoolId = await launchPool.read.nextPoolId();
  const poolId = nextPoolId - 1n;
  const pool   = await launchPool.read.pools([poolId]);

  console.log("\n✅ Pool created!");
  console.log("─────────────────────────────────────────────");
  console.log(`Pool ID          : ${poolId}`);
  console.log(`Project token    : ${pool[0]}`);
  console.log(`Hard cap         : ${formatEther(pool[2])} STT`);
  console.log(`Soft cap         : ${formatEther(pool[3])} STT`);
  console.log(`Min Sybil score  : ${pool[9]}/100`);
  console.log("─────────────────────────────────────────────");
  console.log(`\nNext steps:`);
  console.log(`  1. Get Sybil attested: WALLET=0xYourAddress npm run sybil:check`);
  console.log(`  2. Participate: POOL_ID=${poolId} npm run launch:participate`);
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
