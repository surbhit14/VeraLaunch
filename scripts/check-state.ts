/**
 * scripts/check-state.ts
 *
 * Reads full on-chain state: attestations, pools, vesting schedules,
 * and fetches all historical events to see if AI callbacks have arrived.
 *
 * Usage:
 *   npx hardhat run scripts/check-state.ts --network somnia
 */

import hre from "hardhat";
import { parseAbiItem, formatEther } from "viem";
import * as fs from "fs";
import * as path from "path";

async function main() {
  const deploymentsPath = path.join(__dirname, "../deployments/testnet.json");
  const dep = JSON.parse(fs.readFileSync(deploymentsPath, "utf-8"));

  const publicClient = await hre.viem.getPublicClient();
  const [signer]     = await hre.viem.getWalletClients();
  const wallet       = signer.account.address;

  const sybilRegistry = await hre.viem.getContractAt("SybilRegistry", dep.SybilRegistry);
  const launchPool    = await hre.viem.getContractAt("LaunchPool",    dep.LaunchPool);
  const vestingVault  = await hre.viem.getContractAt("VestingVault",  dep.VestingVault);

  const latest = await publicClient.getBlockNumber();
  console.log("═══════════════════════════════════════════════════════");
  console.log("VeraLaunch — On-chain State Check");
  console.log("═══════════════════════════════════════════════════════");
  console.log(`Wallet    : ${wallet}`);
  console.log(`At block  : ${latest}`);
  console.log("═══════════════════════════════════════════════════════\n");

  // Somnia RPC limits getLogs to 1000 blocks per request
  const CHUNK = 990n;
  const fromBlock = latest > 100_000n ? latest - 100_000n : 0n;

  async function getLogs(address: `0x${string}`, event: any) {
    const logs: any[] = [];
    let from = fromBlock;
    while (from <= latest) {
      const to = from + CHUNK > latest ? latest : from + CHUNK;
      const chunk = await publicClient.getLogs({ address, event, fromBlock: from, toBlock: to });
      logs.push(...chunk);
      from = to + 1n;
    }
    return logs;
  }

  // ── SybilRegistry ──────────────────────────────────────────────────────
  console.log("── SybilRegistry ──────────────────────────────────────");

  const att = await sybilRegistry.read.attestations([wallet]) as any;
  // [0]=score [1]=timestamp [2]=expiresAt [3]=exists
  const score  = Number(att[0]);
  const ts     = att[1] as bigint;
  const exp    = att[2] as bigint;
  const exists = Boolean(att[3]);
  if (exists) {
    const nowSec = BigInt(Math.floor(Date.now() / 1000));
    const expired = nowSec > exp;
    console.log(`Attestation: EXISTS | score=${score}/100 | ${expired ? "EXPIRED" : `expires in ${Math.floor(Number(exp - nowSec) / 86400)} days`}`);
    console.log(`  Issued at  : ${new Date(Number(ts) * 1000).toISOString()}`);
    console.log(`  Expires at : ${new Date(Number(exp) * 1000).toISOString()}`);
  } else {
    console.log(`Attestation: NONE for ${wallet}`);
  }

  // Historical events
  const SYBIL_ADDR  = dep.SybilRegistry as `0x${string}`;
  const VAULT_ADDR  = dep.VestingVault  as `0x${string}`;
  const reqLogs    = await getLogs(SYBIL_ADDR, parseAbiItem("event AttestationRequested(address indexed wallet, uint256 indexed requestId)"));
  const storedLogs = await getLogs(SYBIL_ADDR, parseAbiItem("event AttestationStored(address indexed wallet, uint8 score, uint256 txCount)"));
  const failLogs   = await getLogs(SYBIL_ADDR, parseAbiItem("event AttestationFailed(address indexed wallet, uint8 status)"));

  console.log(`\nHistorical events (last window):`);
  console.log(`  AttestationRequested : ${reqLogs.length}`);
  reqLogs.forEach(l => { const a = l.args as any; console.log(`    block=${l.blockNumber} wallet=${a.wallet} reqId=${a.requestId}`); });
  console.log(`  AttestationStored    : ${storedLogs.length}  ← JSON API callback stored a score`);
  storedLogs.forEach(l => { const a = l.args as any; console.log(`    block=${l.blockNumber} wallet=${a.wallet} score=${a.score} txCount=${a.txCount}`); });
  console.log(`  AttestationFailed    : ${failLogs.length}`);
  failLogs.forEach(l => { const a = l.args as any; console.log(`    block=${l.blockNumber} wallet=${a.wallet} status=${a.status}`); });

  // ── LaunchPool ──────────────────────────────────────────────────────────
  console.log("\n── LaunchPool ─────────────────────────────────────────");
  const nextPoolId = await launchPool.read.nextPoolId();
  console.log(`Total pools: ${nextPoolId}`);

  // hardhat-viem returns positional arrays for struct mapping getters — use indices
  // Pool: [0]=projectToken [1]=tokenPrice [2]=hardCap [3]=softCap [4]=perWalletCap
  //       [5]=totalTokens [6]=startTime [7]=endTime [8]=totalRaised [9]=minSybilScore
  //       [10]=finalized [11]=softCapMet
  for (let i = 0n; i < (nextPoolId as bigint); i++) {
    const p = await launchPool.read.pools([i]) as any;
    const nowSec = BigInt(Math.floor(Date.now() / 1000));
    const status = p[10] ? "FINALIZED"
      : nowSec < p[6] ? "UPCOMING"
      : nowSec > p[7] ? "ENDED (not finalized)"
      : "LIVE";
    console.log(`\nPool #${i}: ${status}`);
    console.log(`  projectToken  : ${p[0]}`);
    console.log(`  hardCap       : ${formatEther(p[2])} STT`);
    console.log(`  softCap       : ${formatEther(p[3])} STT`);
    console.log(`  totalRaised   : ${formatEther(p[8])} STT`);
    console.log(`  minSybilScore : ${p[9]}`);
    console.log(`  finalized     : ${p[10]} | softCapMet: ${p[11]}`);
    console.log(`  startTime     : ${new Date(Number(p[6]) * 1000).toISOString()}`);
    console.log(`  endTime       : ${new Date(Number(p[7]) * 1000).toISOString()}`);

    const contrib = await launchPool.read.contributions([i, wallet]);
    if ((contrib as bigint) > 0n) {
      console.log(`  Your contrib  : ${formatEther(contrib as bigint)} STT`);
    }
  }

  // ── VestingVault ────────────────────────────────────────────────────────
  console.log("\n── VestingVault ───────────────────────────────────────");
  const nextSchedId = await vestingVault.read.nextScheduleId();
  console.log(`Total schedules: ${nextSchedId}`);

  const STATUS = ["PENDING", "VERIFYING", "PASSED", "FAILED"];

  // Schedule: [0]=beneficiary [1]=token [2]=totalAmount [3]=unlockedAmount
  // Milestone tuple: [0]=description [1]=evidenceUrl [2]=unlockAmount [3]=deadline [4]=status
  for (let i = 0n; i < (nextSchedId as bigint); i++) {
    const s = await vestingVault.read.schedules([i]) as any;
    const ms = await vestingVault.read.getMilestones([i]) as any[];
    console.log(`\nSchedule #${i}:`);
    console.log(`  beneficiary   : ${s[0]}`);
    console.log(`  token         : ${s[1]}`);
    console.log(`  totalAmount   : ${formatEther(s[2])}`);
    console.log(`  unlockedAmount: ${formatEther(s[3])}`);
    ms.forEach((m: any, idx: number) => {
      const nowSec = BigInt(Math.floor(Date.now() / 1000));
      const deadline = m[3] ?? m.deadline;
      const unlockAmt = m[2] ?? m.unlockAmount;
      const status    = Number(m[4] ?? m.status);
      const overdue = nowSec > deadline ? " (OVERDUE)" : ` (${Math.floor(Number(deadline - nowSec) / 86400)}d left)`;
      console.log(`  Milestone ${idx}: [${STATUS[status]}]${overdue} unlock=${formatEther(unlockAmt)}`);
      console.log(`    "${m[0] ?? m.description}"`);
    });
  }

  // ── VestingVault historical events
  const msClaimedLogs = await getLogs(VAULT_ADDR, parseAbiItem("event MilestoneClaimed(uint256 indexed scheduleId, uint256 indexed milestoneIndex, uint256 indexed parseRequestId)"));
  const msPassedLogs  = await getLogs(VAULT_ADDR, parseAbiItem("event MilestonePassed(uint256 indexed scheduleId, uint256 indexed milestoneIndex, uint256 unlockedAmount)"));
  const msFailedLogs  = await getLogs(VAULT_ADDR, parseAbiItem("event MilestoneFailed(uint256 indexed scheduleId, uint256 indexed milestoneIndex)"));
  const evVaultLogs   = await getLogs(VAULT_ADDR, parseAbiItem("event EvidenceCollected(uint256 indexed scheduleId, uint256 indexed milestoneIndex, uint256 indexed llmRequestId)"));

  console.log(`\nVestingVault events:`);
  console.log(`  MilestoneClaimed   : ${msClaimedLogs.length}`);
  msClaimedLogs.forEach(l => { const a = l.args as any; console.log(`    block=${l.blockNumber} schedule=${a.scheduleId} milestone=${a.milestoneIndex}`); });
  console.log(`  EvidenceCollected  : ${evVaultLogs.length}  ← Step1 callback`);
  evVaultLogs.forEach(l => { const a = l.args as any; console.log(`    block=${l.blockNumber} schedule=${a.scheduleId} milestone=${a.milestoneIndex} llmReqId=${a.llmRequestId}`); });
  console.log(`  MilestonePassed    : ${msPassedLogs.length}  ← AI said PASS`);
  msPassedLogs.forEach(l => { const a = l.args as any; console.log(`    block=${l.blockNumber} schedule=${a.scheduleId} milestone=${a.milestoneIndex} unlocked=${formatEther(a.unlockedAmount)}`); });
  console.log(`  MilestoneFailed    : ${msFailedLogs.length}  ← AI said FAIL`);
  msFailedLogs.forEach(l => { const a = l.args as any; console.log(`    block=${l.blockNumber} schedule=${a.scheduleId} milestone=${a.milestoneIndex}`); });

  console.log("\n═══════════════════════════════════════════════════════");
  console.log("Summary:");
  if (!exists) console.log("  ⚠ No attestation stored yet — AI callback still pending or failed");
  else console.log(`  ✓ Attestation on-chain: score=${score}/100`);
  console.log("═══════════════════════════════════════════════════════");
}

main().catch((err) => { console.error(err); process.exit(1); });
