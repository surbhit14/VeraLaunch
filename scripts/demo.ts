/**
 * scripts/demo.ts
 *
 * Drops a short-lived scenario for the Autonomous Keeper to process LIVE:
 * a treasury-gated pool that opens in ~5s, ends in ~50s, with one AI-verifiable
 * milestone. Run the keeper in another terminal and watch it autonomously
 * finalize the sale and invoke Somnia's AI to release the escrowed funds.
 *
 * Usage:
 *   Terminal 1:  npx hardhat run scripts/keeper.ts --network somnia
 *   Terminal 2:  npx hardhat run scripts/demo.ts   --network somnia
 */

import hre from "hardhat";
import { parseEther, formatEther } from "viem";
import * as fs from "fs";
import * as path from "path";

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function main() {
  const dep = JSON.parse(fs.readFileSync(path.join(__dirname, "../deployments/testnet.json"), "utf-8"));
  const [signer] = await hre.viem.getWalletClients();
  const lp = await hre.viem.getContractAt("LaunchPool", dep.LaunchPool as `0x${string}`);
  const token = await hre.viem.deployContract("MockERC20", ["Helios", "HLX", parseEther("100000")]);

  console.log("═══════════════════════════════════════════════════════════");
  console.log("  VeraLaunch — Self-running demo scenario");
  console.log("═══════════════════════════════════════════════════════════");
  console.log(`  Token: Helios (HLX) ${token.address}`);

  const PRICE = parseEther("0.001");
  const TOTAL = parseEther("3000");
  await token.write.approve([dep.LaunchPool as `0x${string}`, TOTAL], { account: signer.account });
  await sleep(3000);

  const now = BigInt(Math.floor(Date.now() / 1000));
  const start = now + 5n, end = start + 50n;

  await lp.write.createPool([
    {
      projectToken: token.address, tokenPrice: PRICE,
      hardCap: parseEther("3"), softCap: parseEther("1"), perWalletCap: parseEther("2"),
      totalTokens: TOTAL, startTime: start, endTime: end, minSybilScore: 0,
      buyerCliff: 0n, buyerVest: 120n,
    },
    [
      { description: "Ethereum supports smart contracts written in the Solidity language",
        evidenceDomain: "ethereum.org", releaseBps: 10000, deadline: end + 3600n },
    ],
  ], { account: signer.account });
  await sleep(4000);

  const poolId = (await lp.read.nextPoolId() as bigint) - 1n;
  console.log(`  ✓ pool #${poolId} created — treasury-gated, opens in ~5s, ends in ~50s`);

  console.log("\n  Waiting for the sale to open, then contributing 1.5 STT…");
  await sleep(7000);
  await lp.write.participate([poolId], { account: signer.account, value: parseEther("1.5") });
  console.log(`  ✓ contributed 1.5 STT to pool #${poolId}`);

  console.log("\n───────────────────────────────────────────────────────────");
  console.log("  Now watch the Keeper terminal. With no further input it will:");
  console.log(`    1. discover pool #${poolId} has ended  → finalize it`);
  console.log("    2. discover the milestone is due       → invoke Somnia AI");
  console.log("    3. on AI PASS                          → release escrowed STT");
  console.log("  Or open the UI → Agents tab to see it happen live.");
  console.log("───────────────────────────────────────────────────────────");
}

main().catch(e => { console.error(e); process.exit(1); });
