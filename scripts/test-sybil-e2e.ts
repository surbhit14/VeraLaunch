/**
 * scripts/test-sybil-e2e.ts
 *
 * End-to-end proof of the JSON-API SybilRegistry:
 *   requestAttestation(wallet) → JSON API agent fetches transactions_count
 *   → handleTxCount derives a score on-chain → attestation stored.
 *
 * Usage:
 *   npx hardhat run scripts/test-sybil-e2e.ts --network somnia
 *   WALLET=0x... npx hardhat run scripts/test-sybil-e2e.ts --network somnia
 */

import hre from "hardhat";
import { parseEther, formatEther } from "viem";
import * as fs from "fs";
import * as path from "path";

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function main() {
  const dep = JSON.parse(fs.readFileSync(path.join(__dirname, "../deployments/testnet.json"), "utf-8"));
  const [signer] = await hre.viem.getWalletClients();
  const publicClient = await hre.viem.getPublicClient();
  const wallet = (process.env.WALLET as `0x${string}`) ?? signer.account.address;

  const sybil = await hre.viem.getContractAt("SybilRegistry", dep.SybilRegistry as `0x${string}`);

  console.log("═══════════════════════════════════════════════════════════");
  console.log("  SybilRegistry — End-to-End (JSON API agent)");
  console.log("═══════════════════════════════════════════════════════════");
  console.log(`  SybilRegistry : ${dep.SybilRegistry}`);
  console.log(`  Wallet        : ${wallet}`);
  const bal = await publicClient.getBalance({ address: signer.account.address });
  console.log(`  STT balance   : ${formatEther(bal)} STT`);

  const preReqTime = BigInt(Math.floor(Date.now() / 1000));

  console.log("\n── requestAttestation (0.40 STT, 2 signals) ───────────────");
  const tx = await sybil.write.requestAttestation([wallet], {
    account: signer.account, value: parseEther("0.40"),
  });
  console.log(`  tx: ${tx}`);
  console.log("  JSON API agent fetching transactions_count from the explorer…");

  console.log("\n── Polling for attestation (up to 5 min) ──────────────────");
  const start = Date.now();
  let done = false;
  while (Date.now() - start < 5 * 60 * 1000) {
    await sleep(8000);
    const elapsed = Math.floor((Date.now() - start) / 1000);
    const a = await sybil.read.attestations([wallet]) as any;
    const exists = a[3], ts = a[1] as bigint;
    if (exists && ts >= preReqTime) {
      process.stdout.write("\n");
      console.log("═══════════════════════════════════════════════════════════");
      console.log("  RESULT");
      console.log("═══════════════════════════════════════════════════════════");
      console.log(`  ✅ Attestation stored`);
      console.log(`     score     : ${a[0]}/100`);
      console.log(`     issued at : ${new Date(Number(a[1]) * 1000).toISOString()}`);
      console.log(`     expires   : ${new Date(Number(a[2]) * 1000).toISOString()}`);
      const v60 = await sybil.read.isVerified([wallet, 60]);
      const v30 = await sybil.read.isVerified([wallet, 30]);
      console.log(`     isVerified(>=30): ${v30}`);
      console.log(`     isVerified(>=60): ${v60}`);
      console.log("═══════════════════════════════════════════════════════════");
      done = true;
      break;
    }
    process.stdout.write(`\r  [${elapsed}s] waiting for JSON API callback…   `);
  }
  if (!done) {
    process.stdout.write("\n");
    console.log("  ⏱ No attestation within 5 min — check AgentDebug/AttestationFailed events.");
  }
}

main().catch(e => { console.error(e); process.exit(1); });
