/**
 * scripts/deploy-trust.ts
 *
 * Deploys ONLY the TrustOracle and merges its address into deployments/testnet.json,
 * preserving the existing contracts + seeded pools. Then registers the current
 * demo pools so the keeper can autonomously score them.
 *
 * Usage:  npx hardhat run scripts/deploy-trust.ts --network somnia
 */

import hre from "hardhat";
import * as fs from "fs";
import * as path from "path";

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// poolId → { name, domain } for the existing demo pools (real domains so the LLM has signal)
const REGISTER: Record<number, { name: string; domain: string }> = {
  1: { name: "Nova Finance",    domain: "ethereum.org" },
  2: { name: "Pulse Network",   domain: "bitcoin.org" },
  3: { name: "Aether Protocol", domain: "somnia.network" },
  4: { name: "Quark Labs",      domain: "uniswap.org" },
};

async function main() {
  const deploymentsPath = path.join(__dirname, "../deployments/testnet.json");
  const dep = JSON.parse(fs.readFileSync(deploymentsPath, "utf-8"));
  const [signer] = await hre.viem.getWalletClients();

  console.log("Deploying TrustOracle…");
  const trust = await hre.viem.deployContract("TrustOracle");
  console.log(`  ✓ TrustOracle: ${trust.address}`);

  dep.TrustOracle = trust.address;
  fs.writeFileSync(deploymentsPath, JSON.stringify(dep, null, 2));
  console.log(`  ✓ merged into deployments/testnet.json`);

  console.log("\nRegistering demo projects (so the keeper can auto-score them)…");
  const lp = await hre.viem.getContractAt("LaunchPool", dep.LaunchPool as `0x${string}`);
  const nextPoolId = Number(await lp.read.nextPoolId());

  for (const [idStr, meta] of Object.entries(REGISTER)) {
    const poolId = Number(idStr);
    if (poolId >= nextPoolId) continue;
    try {
      await trust.write.registerProject([BigInt(poolId), meta.name, meta.domain], { account: signer.account });
      await sleep(2500);
      console.log(`  ✓ registered pool #${poolId} → ${meta.name} (${meta.domain})`);
    } catch (e: any) {
      console.log(`  · pool #${poolId} skipped: ${e.shortMessage ?? e.message}`);
    }
  }

  console.log("\nDone. The keeper will discover these and request AI trust scores autonomously.");
}

main().catch(e => { console.error(e); process.exit(1); });
