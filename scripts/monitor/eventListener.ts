/**
 * scripts/monitor/eventListener.ts
 *
 * Fetches historical events (last 5000 blocks, in 990-block chunks to satisfy
 * Somnia's 1000-block getLogs limit) then subscribes for live events.
 *
 * Usage:
 *   npx hardhat run scripts/monitor/eventListener.ts --network somnia
 */

import hre from "hardhat";
import { parseAbiItem, formatEther } from "viem";
import * as fs from "fs";
import * as path from "path";

const CHUNK = 990n;

function ts() { return new Date().toISOString(); }
function pad(label: string, w = 22) { return label.padEnd(w); }

async function main() {
  const dep = JSON.parse(
    fs.readFileSync(path.join(__dirname, "../../deployments/testnet.json"), "utf-8")
  );

  const publicClient = await hre.viem.getPublicClient();
  const latest = await publicClient.getBlockNumber();
  const fromBlock = latest > 5000n ? latest - 5000n : 0n;

  const SYBIL = dep.SybilRegistry as `0x${string}`;
  const VAULT = dep.VestingVault  as `0x${string}`;
  const POOL  = dep.LaunchPool    as `0x${string}`;

  console.log("══════════════════════════════════════════════════════");
  console.log("  VeraLaunch — Event Monitor");
  console.log("══════════════════════════════════════════════════════");
  console.log(`SybilRegistry : ${SYBIL}`);
  console.log(`VestingVault  : ${VAULT}`);
  console.log(`LaunchPool    : ${POOL}`);
  console.log(`Latest block  : ${latest}`);
  console.log(`Fetching history from block ${fromBlock} (${latest - fromBlock} blocks)`);
  console.log("══════════════════════════════════════════════════════\n");

  // ── Helper: fetch logs in 990-block chunks ─────────────────────────────
  async function fetchLogs(address: `0x${string}`, event: any) {
    const all: any[] = [];
    let from = fromBlock;
    while (from <= latest) {
      const to = from + CHUNK > latest ? latest : from + CHUNK;
      const chunk = await publicClient.getLogs({ address, event, fromBlock: from, toBlock: to });
      all.push(...chunk);
      from = to + 1n;
    }
    return all;
  }

  // ── Historical events ──────────────────────────────────────────────────
  console.log("── Historical events ──────────────────────────────────");

  // SybilRegistry
  const reqLogs = await fetchLogs(SYBIL, parseAbiItem("event AttestationRequested(address indexed wallet, uint256 indexed requestId)"));
  const storedLogs = await fetchLogs(SYBIL, parseAbiItem("event AttestationStored(address indexed wallet, uint8 score, uint256 txCount)"));
  const failLogs   = await fetchLogs(SYBIL, parseAbiItem("event AttestationFailed(address indexed wallet, uint8 status)"));

  // VestingVault
  const msClaimedLogs = await fetchLogs(VAULT, parseAbiItem("event MilestoneClaimed(uint256 indexed scheduleId, uint256 indexed milestoneIndex, uint256 indexed parseRequestId)"));
  const evVaultLogs   = await fetchLogs(VAULT, parseAbiItem("event EvidenceCollected(uint256 indexed scheduleId, uint256 indexed milestoneIndex, uint256 indexed llmRequestId)"));
  const msPassedLogs  = await fetchLogs(VAULT, parseAbiItem("event MilestonePassed(uint256 indexed scheduleId, uint256 indexed milestoneIndex, uint256 unlockedAmount)"));
  const msFailedLogs  = await fetchLogs(VAULT, parseAbiItem("event MilestoneFailed(uint256 indexed scheduleId, uint256 indexed milestoneIndex)"));

  // LaunchPool
  const poolCreatedLogs  = await fetchLogs(POOL, parseAbiItem("event PoolCreated(uint256 indexed poolId, address indexed owner, address indexed projectToken, uint256 hardCap, uint256 softCap)"));
  const participatedLogs = await fetchLogs(POOL, parseAbiItem("event Participated(uint256 indexed poolId, address indexed participant, uint256 amount, uint256 totalRaised)"));
  const finalizedLogs    = await fetchLogs(POOL, parseAbiItem("event PoolFinalized(uint256 indexed poolId, bool softCapMet, uint256 totalRaised)"));

  // Print history
  const allHistory = [
    ...reqLogs   .map(l => ({ block: l.blockNumber, label: "AttestationRequested", detail: () => { const a = l.args as any; return `wallet=${a.wallet?.slice(0,10)} reqId=${a.requestId}`; } })),
    ...storedLogs.map(l => ({ block: l.blockNumber, label: "AttestationStored ✓",  detail: () => { const a = l.args as any; return `wallet=${a.wallet?.slice(0,10)} score=${a.score}/100 txCount=${a.txCount}`; } })),
    ...failLogs  .map(l => ({ block: l.blockNumber, label: "AttestationFailed ✗",  detail: () => { const a = l.args as any; return `wallet=${a.wallet?.slice(0,10)} status=${a.status}`; } })),
    ...msClaimedLogs.map(l => ({ block: l.blockNumber, label: "MilestoneClaimed",  detail: () => { const a = l.args as any; return `schedule=${a.scheduleId} milestone=${a.milestoneIndex}`; } })),
    ...evVaultLogs  .map(l => ({ block: l.blockNumber, label: "EvidenceCollected (V)", detail: () => { const a = l.args as any; return `schedule=${a.scheduleId} milestone=${a.milestoneIndex} llmReqId=${a.llmRequestId}`; } })),
    ...msPassedLogs .map(l => ({ block: l.blockNumber, label: "MilestonePassed ✅",  detail: () => { const a = l.args as any; return `schedule=${a.scheduleId} milestone=${a.milestoneIndex} unlocked=${formatEther(a.unlockedAmount)}`; } })),
    ...msFailedLogs .map(l => ({ block: l.blockNumber, label: "MilestoneFailed ❌",  detail: () => { const a = l.args as any; return `schedule=${a.scheduleId} milestone=${a.milestoneIndex}`; } })),
    ...poolCreatedLogs .map(l => ({ block: l.blockNumber, label: "PoolCreated",    detail: () => { const a = l.args as any; return `pool=${a.poolId} hardCap=${formatEther(a.hardCap)} STT`; } })),
    ...participatedLogs.map(l => ({ block: l.blockNumber, label: "Participated",   detail: () => { const a = l.args as any; return `pool=${a.poolId} participant=${a.participant?.slice(0,10)} amount=${formatEther(a.amount)} STT`; } })),
    ...finalizedLogs   .map(l => ({ block: l.blockNumber, label: "PoolFinalized",  detail: () => { const a = l.args as any; return `pool=${a.poolId} ${a.softCapMet ? "SUCCESS" : "FAILED"} raised=${formatEther(a.totalRaised)} STT`; } })),
  ].sort((a, b) => Number(a.block - b.block));

  if (allHistory.length === 0) {
    console.log(`  No events found in blocks ${fromBlock}–${latest}`);
    console.log(`  (AI callbacks may have not arrived yet, or happened before this window)`);
  } else {
    for (const e of allHistory) {
      console.log(`  [block ${e.block}] ${pad(e.label)} ${e.detail()}`);
    }
  }

  // ── AI pipeline status ─────────────────────────────────────────────────
  console.log("\n── AI Pipeline Status ─────────────────────────────────");
  const step1Done = evLogs.length > 0;
  const step2Done = storedLogs.length > 0 || failLogs.length > 0;
  const msStep1Done = evVaultLogs.length > 0;
  const msStep2Done = msPassedLogs.length > 0 || msFailedLogs.length > 0;

  console.log(`SybilRegistry requests : ${reqLogs.length}`);
  console.log(`  Step 1 (Parse Agent) : ${step1Done ? "✓ callback received" : "⏳ still waiting"}`);
  console.log(`  Step 2 (LLM Agent)   : ${step2Done ? `✓ ${storedLogs.length} stored, ${failLogs.length} failed` : "⏳ still waiting"}`);
  console.log(`VestingVault claims    : ${msClaimedLogs.length}`);
  console.log(`  Step 1 (Parse Agent) : ${msStep1Done ? "✓ callback received" : "⏳ still waiting"}`);
  console.log(`  Step 2 (LLM Agent)   : ${msStep2Done ? `✓ ${msPassedLogs.length} passed, ${msFailedLogs.length} failed` : "⏳ still waiting"}`);

  // ── Live event watching ────────────────────────────────────────────────
  console.log("\n── Watching live (new blocks)... press Ctrl+C to stop ─");

  const sybilAbi = (await hre.artifacts.readArtifact("SybilRegistry")).abi;
  const vaultAbi = (await hre.artifacts.readArtifact("VestingVault")).abi;
  const poolAbi  = (await hre.artifacts.readArtifact("LaunchPool")).abi;

  const events = [
    { address: SYBIL, abi: sybilAbi, eventName: "AttestationRequested" },
    { address: SYBIL, abi: sybilAbi, eventName: "AttestationStored"    },
    { address: SYBIL, abi: sybilAbi, eventName: "AttestationFailed"    },
    { address: VAULT, abi: vaultAbi, eventName: "MilestoneClaimed"     },
    { address: VAULT, abi: vaultAbi, eventName: "EvidenceCollected"    },
    { address: VAULT, abi: vaultAbi, eventName: "MilestonePassed"      },
    { address: VAULT, abi: vaultAbi, eventName: "MilestoneFailed"      },
    { address: VAULT, abi: vaultAbi, eventName: "MilestoneReset"       },
    { address: POOL,  abi: poolAbi,  eventName: "PoolCreated"          },
    { address: POOL,  abi: poolAbi,  eventName: "Participated"         },
    { address: POOL,  abi: poolAbi,  eventName: "PoolFinalized"        },
    { address: POOL,  abi: poolAbi,  eventName: "TokensClaimed"        },
    { address: POOL,  abi: poolAbi,  eventName: "Refunded"             },
  ];

  for (const e of events) {
    publicClient.watchContractEvent({
      address: e.address,
      abi: e.abi,
      eventName: e.eventName,
      onLogs: (logs) => {
        for (const log of logs) {
          const argsStr = Object.entries(log.args as any)
            .map(([k, v]) => `${k}=${typeof v === 'bigint' ? v.toString() : v}`)
            .join(" ");
          console.log(`[${ts()}] [LIVE] ${pad(e.eventName)} ${argsStr}`);
        }
      },
    });
  }

  await new Promise(() => {});
}

main().catch((err) => { console.error(err); process.exit(1); });
