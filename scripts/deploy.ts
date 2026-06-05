/**
 * scripts/deploy.ts
 *
 * Deploys SybilRegistry, VestingVault, LaunchPool (+ MockERC20 for testing).
 * Writes all addresses to deployments/testnet.json.
 *
 * Usage:
 *   npx hardhat run scripts/deploy.ts --network somnia
 */

import hre from "hardhat";
import * as fs from "fs";
import * as path from "path";

async function main() {
  const [deployer] = await hre.viem.getWalletClients();
  const publicClient = await hre.viem.getPublicClient();

  const balance = await publicClient.getBalance({ address: deployer.account.address });
  console.log("─────────────────────────────────────────────");
  console.log("VeraLaunch — Deploy Script");
  console.log("─────────────────────────────────────────────");
  console.log(`Deployer : ${deployer.account.address}`);
  console.log(`Balance  : ${(Number(balance) / 1e18).toFixed(4)} STT`);
  console.log("─────────────────────────────────────────────\n");

  // ── 1. SybilRegistry ──────────────────────────────────────────────────
  console.log("Deploying SybilRegistry...");
  const sybilRegistry = await hre.viem.deployContract("SybilRegistry");
  console.log(`  ✓ SybilRegistry: ${sybilRegistry.address}\n`);

  // ── 2. VestingVault ───────────────────────────────────────────────────
  console.log("Deploying VestingVault...");
  const vestingVault = await hre.viem.deployContract("VestingVault");
  console.log(`  ✓ VestingVault: ${vestingVault.address}\n`);

  // ── 3. LaunchPool (reads SybilRegistry) ──────────────────────────────
  console.log("Deploying LaunchPool...");
  const launchPool = await hre.viem.deployContract("LaunchPool", [
    sybilRegistry.address,
  ]);
  console.log(`  ✓ LaunchPool: ${launchPool.address}\n`);

  // ── 4. MockERC20 (testnet demo token) ────────────────────────────────
  console.log("Deploying MockERC20 (DEMO token for testing)...");
  const mockToken = await hre.viem.deployContract("MockERC20", [
    "Demo Project Token",
    "DEMO",
    BigInt("10000000") * BigInt(10 ** 18), // 10 million tokens
  ]);
  console.log(`  ✓ MockERC20: ${mockToken.address}\n`);

  // ── 5. TrustOracle (buyer-side AI project trust score) ────────────────
  console.log("Deploying TrustOracle...");
  const trustOracle = await hre.viem.deployContract("TrustOracle");
  console.log(`  ✓ TrustOracle: ${trustOracle.address}\n`);

  // ── 6. Write deployments ──────────────────────────────────────────────
  const deploymentsDir = path.join(__dirname, "../deployments");
  fs.mkdirSync(deploymentsDir, { recursive: true });

  const deployments = {
    network: "somnia-testnet",
    chainId: 50312,
    deployedAt: new Date().toISOString(),
    deployer: deployer.account.address,
    SybilRegistry: sybilRegistry.address,
    VestingVault:  vestingVault.address,
    LaunchPool:    launchPool.address,
    MockERC20:     mockToken.address,
    TrustOracle:   trustOracle.address,
  };

  const outputPath = path.join(deploymentsDir, "testnet.json");
  fs.writeFileSync(outputPath, JSON.stringify(deployments, null, 2));

  console.log("─────────────────────────────────────────────");
  console.log("All contracts deployed!");
  console.log(`Addresses written to: ${outputPath}`);
  console.log("─────────────────────────────────────────────");
  console.log(JSON.stringify(deployments, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
