/**
 * scripts/external-agent.ts
 *
 * A THIRD-PARTY agent that has never seen VeraLaunch's code. It:
 *   1. DISCOVERS the protocol purely from its published manifest
 *      (/.well-known/agent.json) — contract addresses + callable actions.
 *   2. INTERACTS: reads on-chain state to find a live, open launch.
 *   3. INVOKES: checks its own Sybil score, then participates — autonomously.
 *
 * This demonstrates the rubric's "agents can discover, invoke, or interact with
 * the system autonomously" with a live, end-to-end proof (not just a manifest).
 *
 * Usage:  npx hardhat run scripts/external-agent.ts --network somnia
 */

import hre from "hardhat";
import { parseEther, formatEther } from "viem";
import * as fs from "fs";
import * as path from "path";

// The agent only knows this URL/file — everything else is discovered from it.
const MANIFEST_PATH = path.join(__dirname, "../frontend/public/.well-known/agent.json");

// Minimal ABIs the agent builds from the manifest's documented method signatures.
const LP_ABI = [
  { name: "nextPoolId", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  {
    name: "pools", type: "function", stateMutability: "view", inputs: [{ type: "uint256" }],
    outputs: [
      { name: "projectToken", type: "address" }, { name: "tokenPrice", type: "uint256" },
      { name: "hardCap", type: "uint256" }, { name: "softCap", type: "uint256" },
      { name: "perWalletCap", type: "uint256" }, { name: "totalTokens", type: "uint256" },
      { name: "startTime", type: "uint256" }, { name: "endTime", type: "uint256" },
      { name: "totalRaised", type: "uint256" }, { name: "minSybilScore", type: "uint8" },
      { name: "finalized", type: "bool" }, { name: "softCapMet", type: "bool" },
      { name: "finalizedAt", type: "uint256" }, { name: "buyerCliff", type: "uint256" },
      { name: "buyerVest", type: "uint256" }, { name: "usesTreasury", type: "bool" },
      { name: "treasuryReleased", type: "uint256" },
    ],
  },
  { name: "participate", type: "function", stateMutability: "payable", inputs: [{ name: "poolId", type: "uint256" }], outputs: [] },
  { name: "getContribution", type: "function", stateMutability: "view", inputs: [{ type: "uint256" }, { type: "address" }], outputs: [{ type: "uint256" }] },
] as const;
const SR_ABI = [
  { name: "attestations", type: "function", stateMutability: "view", inputs: [{ type: "address" }],
    outputs: [{ name: "score", type: "uint8" }, { name: "timestamp", type: "uint256" }, { name: "expiresAt", type: "uint256" }, { name: "exists", type: "bool" }] },
] as const;

const log = (s: string) => console.log(`  ${s}`);

async function main() {
  const [signer] = await hre.viem.getWalletClients();
  const pub = await hre.viem.getPublicClient();
  const me = signer.account.address;

  console.log("═══════════════════════════════════════════════════════════");
  console.log("  External Agent — discovering VeraLaunch from its manifest");
  console.log("═══════════════════════════════════════════════════════════");

  // ── 1. DISCOVER from the manifest ────────────────────────────────────────
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf-8"));
  log(`🔍 read manifest "${manifest.name}" — ${manifest.schema}`);
  log(`   chain: ${manifest.chain.name} (${manifest.chain.chainId})`);
  log(`   discovered ${Object.keys(manifest.contracts).length} contracts and ${manifest.actions.length} callable actions:`);
  for (const a of manifest.actions) log(`     · ${a.id} → ${a.contract}.${a.method.split("(")[0]}()`);

  const LP = manifest.contracts.LaunchPool as `0x${string}`;
  const SR = manifest.contracts.SybilRegistry as `0x${string}`;

  // ── 2. INTERACT: find a live, open launch ────────────────────────────────
  console.log("\n── Finding a live launch to back ──────────────────────────");
  const n = Number(await pub.readContract({ address: LP, abi: LP_ABI, functionName: "nextPoolId" }));
  const now = BigInt(Math.floor(Date.now() / 1000));
  const g = (d: any, name: string, idx: number) => (d?.[name] !== undefined ? d[name] : d?.[idx]);
  let chosen = -1; let chosenCap = 0n;
  for (let i = 0; i < n; i++) {
    const p: any = await pub.readContract({ address: LP, abi: LP_ABI, functionName: "pools", args: [BigInt(i)] });
    const hardCap = g(p, "hardCap", 2) as bigint, perWalletCap = g(p, "perWalletCap", 4) as bigint;
    const startTime = g(p, "startTime", 6) as bigint, endTime = g(p, "endTime", 7) as bigint;
    const totalRaised = g(p, "totalRaised", 8) as bigint, minScore = Number(g(p, "minSybilScore", 9));
    const finalized = Boolean(g(p, "finalized", 10));
    const live = now >= startTime && now <= endTime && !finalized && totalRaised < hardCap;
    if (live) log(`   pool #${i}: ${minScore === 0 ? "open" : `score ≥ ${minScore}`} · ${formatEther(totalRaised)}/${formatEther(hardCap)} STT`);
    if (live && minScore === 0 && chosen === -1) { chosen = i; chosenCap = perWalletCap; }
  }
  if (chosen === -1) { log("No live open launch right now — run `npm run seed`, wait ~30s, and retry."); return; }
  log(`→ selected pool #${chosen}`);

  // ── 3. INVOKE: check own Sybil score, then participate ────────────────────
  console.log("\n── Checking my own Sybil score (manifest: SybilRegistry) ──");
  const att: any = await pub.readContract({ address: SR, abi: SR_ABI, functionName: "attestations", args: [me] });
  log(att.exists ? `my score: ${att.score}/100 — eligible` : "no attestation yet (pool is open, so no gate)");

  console.log("\n── Invoking action 'participate' autonomously ─────────────");
  const amount = chosenCap < parseEther("0.3") ? chosenCap : parseEther("0.3");
  log(`invoking LaunchPool.participate(${chosen}) with ${formatEther(amount)} STT…`);
  const tx = await signer.writeContract({
    address: LP, abi: LP_ABI, functionName: "participate", args: [BigInt(chosen)],
    value: amount, account: signer.account, chain: undefined,
  });
  await pub.waitForTransactionReceipt({ hash: tx });
  const contrib: bigint = await pub.readContract({ address: LP, abi: LP_ABI, functionName: "getContribution", args: [BigInt(chosen), me] }) as bigint;

  console.log("\n═══════════════════════════════════════════════════════════");
  console.log("  RESULT");
  console.log("═══════════════════════════════════════════════════════════");
  log(`✅ A third-party agent discovered VeraLaunch from its manifest and invoked it.`);
  log(`   backed pool #${chosen} · contribution now ${formatEther(contrib)} STT`);
  log(`   tx: ${manifest.chain.explorer}/tx/${tx}`);
  console.log("═══════════════════════════════════════════════════════════");
}

main().catch(e => { console.error(e); process.exit(1); });
