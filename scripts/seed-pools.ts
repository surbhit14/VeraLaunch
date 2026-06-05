/**
 * scripts/seed-pools.ts
 *
 * Creates several varied demo IDO pools (each with its own token) so the
 * Discover swipe feed and Launchpad are populated for a demo.
 *
 * Each pool deploys a fresh MockERC20 (distinct name/symbol → distinct cards),
 * approves the LaunchPool, and creates a pool that goes live ~30s later and
 * stays open for several days.
 *
 * Usage:
 *   npx hardhat run scripts/seed-pools.ts --network somnia
 */

import hre from "hardhat";
import { parseEther, formatEther } from "viem";
import * as fs from "fs";
import * as path from "path";

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// Variety across price, caps, gating, buyer vesting, and milestone treasury.
// Milestones use true, web-searchable claims so they can actually PASS in a demo.
type Milestone = { description: string; evidenceDomain: string; releaseBps: number; deadlineDaysAfterEnd: number };
const POOLS: {
  name: string; symbol: string; domain: string; priceSTT: string; hardCap: string; softCap: string;
  perWallet: string; minScore: number; durationDays: number; buyerVestDays: number; milestones: Milestone[];
}[] = [
  { name: "Nova Finance", symbol: "NOVA", domain: "ethereum.org", priceSTT: "0.001", hardCap: "5", softCap: "1", perWallet: "2",
    minScore: 0, durationDays: 3, buyerVestDays: 0, milestones: [] },
  { name: "Pulse Network", symbol: "PULSE", domain: "bitcoin.org", priceSTT: "0.002", hardCap: "10", softCap: "2", perWallet: "3",
    minScore: 60, durationDays: 5, buyerVestDays: 7, milestones: [
      { description: "Ethereum supports smart contracts written in the Solidity language", evidenceDomain: "ethereum.org", releaseBps: 6000, deadlineDaysAfterEnd: 30 },
      { description: "Bitcoin is a decentralized peer-to-peer digital currency", evidenceDomain: "bitcoin.org", releaseBps: 4000, deadlineDaysAfterEnd: 60 },
    ] },
  { name: "Aether Protocol", symbol: "AETH", domain: "somnia.network", priceSTT: "0.0005", hardCap: "8", softCap: "2", perWallet: "2",
    minScore: 30, durationDays: 2, buyerVestDays: 3, milestones: [
      { description: "Somnia is an EVM-compatible Layer 1 blockchain", evidenceDomain: "somnia.network", releaseBps: 5000, deadlineDaysAfterEnd: 20 },
      { description: "Ethereum completed The Merge to proof of stake", evidenceDomain: "ethereum.org", releaseBps: 5000, deadlineDaysAfterEnd: 45 },
    ] },
  { name: "Quark Labs", symbol: "QRK", domain: "uniswap.org", priceSTT: "0.0015", hardCap: "6", softCap: "1.5", perWallet: "1",
    minScore: 0, durationDays: 4, buyerVestDays: 14, milestones: [] },
];

async function main() {
  const deploymentsPath = path.join(__dirname, "../deployments/testnet.json");
  const dep = JSON.parse(fs.readFileSync(deploymentsPath, "utf-8"));

  const [signer] = await hre.viem.getWalletClients();
  const publicClient = await hre.viem.getPublicClient();
  const launchPool = await hre.viem.getContractAt("LaunchPool", dep.LaunchPool as `0x${string}`);
  const trustOracle = dep.TrustOracle ? await hre.viem.getContractAt("TrustOracle", dep.TrustOracle as `0x${string}`) : null;

  const bal = await publicClient.getBalance({ address: signer.account.address });
  console.log("═══════════════════════════════════════════════════════════");
  console.log("  Seeding demo IDO pools");
  console.log("═══════════════════════════════════════════════════════════");
  console.log(`  LaunchPool : ${dep.LaunchPool}`);
  console.log(`  Deployer   : ${signer.account.address}`);
  console.log(`  STT balance: ${formatEther(bal)} STT`);
  console.log("═══════════════════════════════════════════════════════════\n");

  const created: { id: string; name: string; symbol: string; token: string; live: string }[] = [];

  for (const cfg of POOLS) {
    console.log(`── ${cfg.name} (${cfg.symbol}) ────────────────────────────`);

    // tokens needed to cover the hard cap at this price, plus a small buffer
    const totalTokensWhole = Number(cfg.hardCap) / Number(cfg.priceSTT);
    const totalTokens = parseEther(String(totalTokensWhole));
    const supply = parseEther(String(totalTokensWhole + 1000));

    // 1. Deploy a distinct demo token
    const token = await hre.viem.deployContract("MockERC20", [cfg.name, cfg.symbol, supply]);
    console.log(`  token deployed : ${token.address}`);
    await sleep(2500);

    // 2. Approve LaunchPool to pull the project tokens
    await token.write.approve([dep.LaunchPool as `0x${string}`, totalTokens], { account: signer.account });
    await sleep(2500);

    // 3. Create the pool — live in ~30s, open for durationDays
    const now = BigInt(Math.floor(Date.now() / 1000));
    const startTime = now + 30n;
    const endTime = startTime + BigInt(cfg.durationDays * 86400);

    const fundMilestones = cfg.milestones.map(m => ({
      description:    m.description,
      evidenceDomain: m.evidenceDomain,
      releaseBps:     m.releaseBps,
      deadline:       endTime + BigInt(m.deadlineDaysAfterEnd * 86400),
    }));

    await launchPool.write.createPool([
      {
        projectToken:  token.address,
        tokenPrice:    parseEther(cfg.priceSTT),
        hardCap:       parseEther(cfg.hardCap),
        softCap:       parseEther(cfg.softCap),
        perWalletCap:  parseEther(cfg.perWallet),
        totalTokens,
        startTime,
        endTime,
        minSybilScore: cfg.minScore,
        buyerCliff:    0n,
        buyerVest:     BigInt(cfg.buyerVestDays * 86400),
      },
      fundMilestones,
    ], { account: signer.account });
    await sleep(3500);

    const nextId = await launchPool.read.nextPoolId() as bigint;
    const poolId = (nextId - 1n).toString();
    // Register the project so the keeper can autonomously trust-score it
    if (trustOracle) {
      try {
        await trustOracle.write.registerProject([BigInt(poolId), cfg.name, cfg.domain], { account: signer.account });
        await sleep(2500);
      } catch { /* already registered */ }
    }

    const tags = [
      cfg.minScore > 0 ? `score ≥ ${cfg.minScore}` : "open",
      cfg.buyerVestDays > 0 ? `${cfg.buyerVestDays}d vest` : "instant",
      cfg.milestones.length > 0 ? `${cfg.milestones.length} AI milestones` : "no escrow",
      trustOracle ? "trust-registered" : "",
    ].filter(Boolean).join(" · ");
    console.log(`  ✓ pool #${poolId} created — ${tags}, ${cfg.hardCap} STT cap, live in ~30s\n`);

    created.push({
      id: poolId, name: cfg.name, symbol: cfg.symbol, token: token.address,
      live: new Date(Number(startTime) * 1000).toLocaleTimeString(),
    });
  }

  console.log("═══════════════════════════════════════════════════════════");
  console.log(`  ✅ Seeded ${created.length} pools`);
  console.log("═══════════════════════════════════════════════════════════");
  for (const c of created) {
    console.log(`  #${c.id}  ${c.symbol.padEnd(6)} ${c.name.padEnd(18)} live @ ${c.live}`);
  }
  console.log("\n  Open the UI → Discover, wait ~30s, and swipe. (Refresh to pick up live state.)");
}

main().catch(e => { console.error(e); process.exit(1); });
