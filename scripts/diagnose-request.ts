/**
 * scripts/diagnose-request.ts
 *
 * READ-ONLY ground-truth reader for failed Somnia agent requests.
 * Spends 0 STT, no redeploy. Reads the actual Request struct from the platform
 * (including each validator's Response.result bytes — the real error message)
 * to find WHY the Parse Website Agent returns status=3 (Failed).
 *
 * Usage:
 *   npx hardhat run scripts/diagnose-request.ts --network somnia
 *   REQUEST_IDS=4530653,4521967 npx hardhat run scripts/diagnose-request.ts --network somnia
 */

import hre from "hardhat";
import { parseAbiItem, decodeAbiParameters, formatEther } from "viem";
import * as fs from "fs";
import * as path from "path";

const PLATFORM_ADDR = "0x037Bb9C718F3f7fe5eCBDB0b600D607b52706776" as `0x${string}`;

// Minimal platform ABI (subset of IAgentRequester) needed for diagnosis
const PLATFORM_ABI = [
  { name: "getRequestDeposit",         type: "function", stateMutability: "view", inputs: [],                                              outputs: [{ type: "uint256" }] },
  { name: "getAdvancedRequestDeposit", type: "function", stateMutability: "view", inputs: [{ name: "subcommitteeSize", type: "uint256" }], outputs: [{ type: "uint256" }] },
  { name: "hasRequest",                type: "function", stateMutability: "view", inputs: [{ name: "requestId", type: "uint256" }],         outputs: [{ type: "bool" }] },
  {
    name: "getRequest", type: "function", stateMutability: "view",
    inputs: [{ name: "requestId", type: "uint256" }],
    outputs: [{
      name: "", type: "tuple",
      components: [
        { name: "id",               type: "uint256" },
        { name: "requester",        type: "address" },
        { name: "callbackAddress",  type: "address" },
        { name: "callbackSelector", type: "bytes4"  },
        { name: "subcommittee",     type: "address[]" },
        { name: "responses",        type: "tuple[]", components: [
          { name: "validator",     type: "address" },
          { name: "result",        type: "bytes"   },
          { name: "status",        type: "uint8"   },
          { name: "receipt",       type: "uint256" },
          { name: "timestamp",     type: "uint256" },
          { name: "executionCost", type: "uint256" },
        ]},
        { name: "responseCount",   type: "uint256" },
        { name: "failureCount",    type: "uint256" },
        { name: "threshold",       type: "uint256" },
        { name: "createdAt",       type: "uint256" },
        { name: "deadline",        type: "uint256" },
        { name: "status",          type: "uint8"   },
        { name: "consensusType",   type: "uint8"   },
        { name: "remainingBudget", type: "uint256" },
      ],
    }],
  },
] as const;

const RESPONSE_STATUS = ["None", "Pending", "Success", "Failed", "TimedOut"];
const CONSENSUS_TYPE  = ["Majority", "Threshold"];
const CHUNK = 990n; // Somnia RPC hard-limits getLogs to 1000 blocks

function hexToUtf8(hex: string): string {
  try {
    const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
    let out = "";
    for (let i = 0; i < clean.length; i += 2) {
      const code = parseInt(clean.substr(i, 2), 16);
      if (code >= 32 && code < 127) out += String.fromCharCode(code);
      else if (code !== 0) out += ".";
    }
    return out;
  } catch { return ""; }
}

/** Try every reasonable decoding of a validator's result bytes. */
function decodeResult(result: `0x${string}`): string {
  if (!result || result === "0x") return "(empty)";
  // 1. ABI string
  try {
    const [s] = decodeAbiParameters([{ type: "string" }], result);
    if (s && (s as string).length > 0) return `string: "${s}"`;
  } catch { /* fall through */ }
  // 2. ABI (string,...) — sometimes wrapped
  // 3. Raw UTF-8 sniff (error strings are often plain ASCII)
  const ascii = hexToUtf8(result);
  const printable = ascii.replace(/\./g, "").trim();
  if (printable.length > 3) return `ascii: "${ascii}"`;
  return `raw bytes (${(result.length - 2) / 2} bytes): ${result.slice(0, 138)}${result.length > 138 ? "…" : ""}`;
}

async function main() {
  const dep = JSON.parse(fs.readFileSync(path.join(__dirname, "../deployments/testnet.json"), "utf-8"));
  const publicClient = await hre.viem.getPublicClient();

  // Read helper — uses the publicClient directly with our explicit ABI
  const platform = {
    read: {
      getRequestDeposit:         () => publicClient.readContract({ address: PLATFORM_ADDR, abi: PLATFORM_ABI, functionName: "getRequestDeposit" }),
      getAdvancedRequestDeposit: (args: [bigint]) => publicClient.readContract({ address: PLATFORM_ADDR, abi: PLATFORM_ABI, functionName: "getAdvancedRequestDeposit", args }),
      hasRequest:                (args: [bigint]) => publicClient.readContract({ address: PLATFORM_ADDR, abi: PLATFORM_ABI, functionName: "hasRequest", args }),
      getRequest:                (args: [bigint]) => publicClient.readContract({ address: PLATFORM_ADDR, abi: PLATFORM_ABI, functionName: "getRequest", args }),
    },
  };

  console.log("═══════════════════════════════════════════════════════════");
  console.log("  Somnia Request Diagnostic (read-only)");
  console.log("═══════════════════════════════════════════════════════════");
  console.log(`Platform      : ${PLATFORM_ADDR}`);
  console.log(`SybilRegistry : ${dep.SybilRegistry}`);
  console.log(`VestingVault  : ${dep.VestingVault}`);

  // ── 1. Platform deposit requirements ───────────────────────────────────
  console.log("\n── Platform deposit requirements ──────────────────────────");
  let baseDeposit = 0n, adv1 = 0n, adv3 = 0n;
  try { baseDeposit = await platform.read.getRequestDeposit() as bigint; }
  catch (e: any) { console.log(`  getRequestDeposit() reverted: ${e.shortMessage ?? e.message}`); }
  try { adv1 = await platform.read.getAdvancedRequestDeposit([1n]) as bigint; }
  catch (e: any) { console.log(`  getAdvancedRequestDeposit(1) reverted: ${e.shortMessage ?? e.message}`); }
  try { adv3 = await platform.read.getAdvancedRequestDeposit([3n]) as bigint; }
  catch (e: any) { console.log(`  getAdvancedRequestDeposit(3) reverted: ${e.shortMessage ?? e.message}`); }

  console.log(`  getRequestDeposit()              : ${formatEther(baseDeposit)} STT`);
  console.log(`  getAdvancedRequestDeposit(1)     : ${formatEther(adv1)} STT`);
  console.log(`  getAdvancedRequestDeposit(3)     : ${formatEther(adv3)} STT`);
  console.log(`  Our PARSE_DEPOSIT (config)       : 0.33 STT`);
  console.log(`  Our LLM_DEPOSIT   (config)       : 0.24 STT`);
  if (baseDeposit > 0n && baseDeposit > 33n * 10n ** 16n)
    console.log(`  ⚠ Base deposit (${formatEther(baseDeposit)}) > our PARSE_DEPOSIT (0.33) → possible HYPOTHESIS 3`);

  // ── 2. Collect request IDs to inspect ──────────────────────────────────
  let ids: bigint[] = [];
  if (process.env.REQUEST_IDS) {
    ids = process.env.REQUEST_IDS.split(",").map(s => BigInt(s.trim()));
  } else {
    // Scan the current SybilRegistry for AttestationRequested events (chunked)
    const latest = await publicClient.getBlockNumber();
    const fromBlock = latest > 50_000n ? latest - 50_000n : 0n;
    console.log(`\n── Scanning AttestationRequested in blocks ${fromBlock}–${latest} ──`);
    let from = fromBlock;
    const ev = parseAbiItem("event AttestationRequested(address indexed wallet, uint256 indexed requestId)");
    while (from <= latest) {
      const to = from + CHUNK > latest ? latest : from + CHUNK;
      const logs = await publicClient.getLogs({ address: dep.SybilRegistry as `0x${string}`, event: ev, fromBlock: from, toBlock: to });
      for (const l of logs) ids.push((l.args as any).requestId as bigint);
      from = to + 1n;
    }
    console.log(`  Found ${ids.length} request id(s): ${ids.join(", ") || "(none)"}`);
    // Always include the known historical failure for reference
    if (!ids.includes(4530653n)) ids.push(4530653n);
  }

  // ── 3. Inspect each request ─────────────────────────────────────────────
  const verdicts: string[] = [];

  for (const id of ids) {
    console.log(`\n═══ Request ${id} ═══════════════════════════════════════`);
    let exists = false;
    try { exists = await platform.read.hasRequest([id]) as boolean; }
    catch (e: any) { console.log(`  hasRequest reverted: ${e.shortMessage ?? e.message}`); }

    if (!exists) {
      console.log(`  hasRequest(${id}) = false — platform no longer retains this request.`);
      continue;
    }

    let req: any;
    try { req = await platform.read.getRequest([id]); }
    catch (e: any) { console.log(`  getRequest reverted: ${e.shortMessage ?? e.message}`); continue; }

    console.log(`  status          : ${req.status} (${RESPONSE_STATUS[Number(req.status)] ?? "?"})`);
    console.log(`  requester       : ${req.requester}`);
    console.log(`  agent callback  : ${req.callbackAddress} sel=${req.callbackSelector}`);
    console.log(`  subcommittee    : ${req.subcommittee.length} validator(s)`);
    console.log(`  responseCount   : ${req.responseCount}`);
    console.log(`  failureCount    : ${req.failureCount}`);
    console.log(`  threshold       : ${req.threshold}`);
    console.log(`  consensusType   : ${req.consensusType} (${CONSENSUS_TYPE[Number(req.consensusType)] ?? "?"})`);
    console.log(`  remainingBudget : ${formatEther(req.remainingBudget)} STT`);
    console.log(`  createdAt       : ${new Date(Number(req.createdAt) * 1000).toISOString()}`);
    console.log(`  deadline        : ${new Date(Number(req.deadline) * 1000).toISOString()}`);

    console.log(`  responses[${req.responses.length}]:`);
    for (let i = 0; i < req.responses.length; i++) {
      const r = req.responses[i];
      console.log(`    [${i}] validator=${r.validator}`);
      console.log(`        status=${r.status} (${RESPONSE_STATUS[Number(r.status)] ?? "?"}) executionCost=${formatEther(r.executionCost)} STT`);
      console.log(`        result=${decodeResult(r.result)}`);
    }

    // ── Per-request verdict ──────────────────────────────────────────────
    const allResultText = req.responses.map((r: any) => decodeResult(r.result)).join(" | ").toLowerCase();
    if (req.remainingBudget !== undefined && req.responses.some((r: any) => Number(r.executionCost) > 0) &&
        BigInt(req.remainingBudget) === 0n && Number(req.status) === 3) {
      verdicts.push(`Req ${id}: budget exhausted → HYPOTHESIS 3 (raise deposit)`);
    } else if (/fetch|unreachable|resolve|http|timeout|url/.test(allResultText)) {
      verdicts.push(`Req ${id}: response mentions fetch/url → HYPOTHESIS 2 (resolveUrl) or URL`);
    } else if (/decode|abi|selector|payload|revert|invalid/.test(allResultText)) {
      verdicts.push(`Req ${id}: response mentions decode/payload → HYPOTHESIS 4 (signature)`);
    } else if (req.subcommittee.length > 1 && Number(req.status) === 3) {
      verdicts.push(`Req ${id}: ${req.subcommittee.length} validators, no consensus → HYPOTHESIS 1 (single-validator)`);
    } else if (Number(req.status) === 3) {
      verdicts.push(`Req ${id}: Failed — inspect responses above (no keyword match)`);
    }
  }

  // ── 4. Verdict summary ──────────────────────────────────────────────────
  console.log("\n═══════════════════════════════════════════════════════════");
  console.log("  VERDICT");
  console.log("═══════════════════════════════════════════════════════════");
  if (verdicts.length === 0) {
    console.log("  No failed requests retained by platform. Re-run after a fresh");
    console.log("  request, or pass REQUEST_IDS=... for specific ids.");
  } else {
    verdicts.forEach(v => console.log(`  • ${v}`));
  }
  console.log("═══════════════════════════════════════════════════════════");
}

main().catch((e) => { console.error(e); process.exit(1); });
