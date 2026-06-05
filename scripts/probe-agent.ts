/**
 * scripts/probe-agent.ts
 *
 * Submits ONE Parse Website Agent request DIRECTLY to the Somnia platform
 * (bypassing our contracts) and live-polls getRequest() until the request
 * reaches a terminal state — capturing each validator's Response.result bytes
 * (the real error message) before the platform prunes the request.
 *
 * Lets us test every hypothesis cheaply without redeploying contracts:
 *   MODE=basic|advanced      (default basic; advanced = single validator)
 *   RESOLVE_URL=true|false   (default false)
 *   URL=...                  (default Blockscout API for deployer wallet)
 *   CONFIDENCE=0..100        (default 20)
 *
 * Usage:
 *   npx hardhat run scripts/probe-agent.ts --network somnia
 *   MODE=advanced RESOLVE_URL=true npx hardhat run scripts/probe-agent.ts --network somnia
 */

import hre from "hardhat";
import {
  parseEther, formatEther, decodeAbiParameters,
  encodeFunctionData, decodeEventLog,
} from "viem";

const PLATFORM_ADDR = "0x037Bb9C718F3f7fe5eCBDB0b600D607b52706776" as `0x${string}`;
const PARSE_AGENT_ID = 12875401142070969085n;
const LLM_AGENT_ID   = 12847293847561029384n;
const JSON_AGENT_ID  = 13174292974160097713n;

const RESPONSE_STATUS = ["None", "Pending", "Success", "Failed", "TimedOut"];

const PLATFORM_ABI = [
  { name: "getRequestDeposit",         type: "function", stateMutability: "view", inputs: [],                                              outputs: [{ type: "uint256" }] },
  { name: "getAdvancedRequestDeposit", type: "function", stateMutability: "view", inputs: [{ name: "n", type: "uint256" }],                 outputs: [{ type: "uint256" }] },
  { name: "hasRequest",                type: "function", stateMutability: "view", inputs: [{ name: "id", type: "uint256" }],                outputs: [{ type: "bool" }] },
  {
    name: "createRequest", type: "function", stateMutability: "payable",
    inputs: [
      { name: "agentId", type: "uint256" }, { name: "cb", type: "address" },
      { name: "sel", type: "bytes4" }, { name: "payload", type: "bytes" },
    ],
    outputs: [{ name: "requestId", type: "uint256" }],
  },
  {
    name: "createAdvancedRequest", type: "function", stateMutability: "payable",
    inputs: [
      { name: "agentId", type: "uint256" }, { name: "cb", type: "address" },
      { name: "sel", type: "bytes4" }, { name: "payload", type: "bytes" },
      { name: "subcommitteeSize", type: "uint256" }, { name: "threshold", type: "uint256" },
      { name: "consensusType", type: "uint8" }, { name: "timeout", type: "uint256" },
    ],
    outputs: [{ name: "requestId", type: "uint256" }],
  },
  {
    name: "getRequest", type: "function", stateMutability: "view",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [{
      name: "", type: "tuple",
      components: [
        { name: "id", type: "uint256" }, { name: "requester", type: "address" },
        { name: "callbackAddress", type: "address" }, { name: "callbackSelector", type: "bytes4" },
        { name: "subcommittee", type: "address[]" },
        { name: "responses", type: "tuple[]", components: [
          { name: "validator", type: "address" }, { name: "result", type: "bytes" },
          { name: "status", type: "uint8" }, { name: "receipt", type: "uint256" },
          { name: "timestamp", type: "uint256" }, { name: "executionCost", type: "uint256" },
        ]},
        { name: "responseCount", type: "uint256" }, { name: "failureCount", type: "uint256" },
        { name: "threshold", type: "uint256" }, { name: "createdAt", type: "uint256" },
        { name: "deadline", type: "uint256" }, { name: "status", type: "uint8" },
        { name: "consensusType", type: "uint8" }, { name: "remainingBudget", type: "uint256" },
      ],
    }],
  },
  {
    name: "RequestCreated", type: "event",
    inputs: [
      { name: "requestId", type: "uint256", indexed: true },
      { name: "agentId", type: "uint256", indexed: true },
      { name: "perAgentBudget", type: "uint256", indexed: false },
      { name: "payload", type: "bytes", indexed: false },
      { name: "subcommittee", type: "address[]", indexed: false },
    ],
  },
  {
    name: "RequestFinalized", type: "event",
    inputs: [
      { name: "requestId", type: "uint256", indexed: true },
      { name: "status", type: "uint8", indexed: false },
    ],
  },
] as const;

// IParseWebsiteAgent.ExtractString — our 8-param interface
const EXTRACT_STRING_ABI = [{
  name: "ExtractString", type: "function", stateMutability: "nonpayable",
  inputs: [
    { name: "key", type: "string" }, { name: "description", type: "string" },
    { name: "options", type: "string[]" }, { name: "prompt", type: "string" },
    { name: "url", type: "string" }, { name: "resolveUrl", type: "bool" },
    { name: "numPages", type: "uint8" }, { name: "confidenceThreshold", type: "uint8" },
  ],
  outputs: [{ type: "string" }],
}] as const;

// ILLMAgent.inferString
const INFER_STRING_ABI = [{
  name: "inferString", type: "function", stateMutability: "nonpayable",
  inputs: [
    { name: "prompt", type: "string" }, { name: "system", type: "string" },
    { name: "chainOfThought", type: "bool" }, { name: "allowedValues", type: "string[]" },
  ],
  outputs: [{ type: "string" }],
}] as const;

// IJsonApiAgent.fetchUint
const FETCH_UINT_ABI = [{
  name: "fetchUint", type: "function", stateMutability: "nonpayable",
  inputs: [
    { name: "url", type: "string" }, { name: "selector", type: "string" },
    { name: "decimals", type: "uint8" },
  ],
  outputs: [{ type: "uint256" }],
}] as const;

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function hexToUtf8(hex: string): string {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  let out = "";
  for (let i = 0; i < clean.length; i += 2) {
    const code = parseInt(clean.substr(i, 2), 16);
    if (code >= 32 && code < 127) out += String.fromCharCode(code);
    else if (code !== 0) out += ".";
  }
  return out;
}
function decodeResult(result: `0x${string}`): string {
  if (!result || result === "0x") return "(empty)";
  try { const [s] = decodeAbiParameters([{ type: "string" }], result); if ((s as string)?.length) return `string: "${s}"`; } catch {}
  const ascii = hexToUtf8(result);
  if (ascii.replace(/\./g, "").trim().length > 3) return `ascii: "${ascii}"`;
  return `raw(${(result.length - 2) / 2}b): ${result.slice(0, 200)}`;
}

async function main() {
  const [signer]    = await hre.viem.getWalletClients();
  const publicClient = await hre.viem.getPublicClient();
  const me = signer.account.address;

  const AGENT       = (process.env.AGENT ?? "parse").toLowerCase();   // parse | llm | json
  const MODE        = (process.env.MODE ?? "basic").toLowerCase();
  const RESOLVE_URL = (process.env.RESOLVE_URL ?? "false").toLowerCase() === "true";
  const CONFIDENCE  = Number(process.env.CONFIDENCE ?? "20");
  const URL         = process.env.URL ?? `https://shannon-explorer.somnia.network/api/v2/addresses/${me}`;
  const KEY         = process.env.KEY ?? "wallet_activity";
  const DESC        = process.env.DESC ?? "transactions_count, coin_balance, token_transfers_count, is_contract";
  const PROMPT      = process.env.PROMPT ?? "This URL returns JSON from the Blockscout API. Extract transactions_count and coin_balance. Return a short plain-text summary.";
  const NUMPAGES    = Number(process.env.NUMPAGES ?? "1");

  const agentId = AGENT === "llm" ? LLM_AGENT_ID : AGENT === "json" ? JSON_AGENT_ID : PARSE_AGENT_ID;

  console.log("═══════════════════════════════════════════════════════════");
  console.log(`  Agent Probe (direct platform call) — AGENT=${AGENT}`);
  console.log("═══════════════════════════════════════════════════════════");
  console.log(`  agentId       : ${agentId}`);
  console.log(`  MODE          : ${MODE}`);

  // Build payload for the selected agent
  let payload: `0x${string}`;
  if (AGENT === "llm") {
    const llmPrompt = process.env.PROMPT ?? "Reply with exactly one word: PASS";
    console.log(`  llm prompt    : ${llmPrompt}`);
    payload = encodeFunctionData({
      abi: INFER_STRING_ABI,
      functionName: "inferString",
      args: [ llmPrompt, "You are a strict verifier. Reply with one word only.", false, ["PASS", "FAIL"] ],
    });
  } else if (AGENT === "json") {
    const SELECTOR = process.env.SELECTOR ?? "transactions_count";
    const DECIMALS = Number(process.env.DECIMALS ?? "0");
    console.log(`  URL           : ${URL}`);
    console.log(`  selector      : ${SELECTOR}`);
    console.log(`  decimals      : ${DECIMALS}`);
    payload = encodeFunctionData({
      abi: FETCH_UINT_ABI,
      functionName: "fetchUint",
      args: [ URL, SELECTOR, DECIMALS ],
    });
  } else {
    console.log(`  resolveUrl    : ${RESOLVE_URL}`);
    console.log(`  confidence    : ${CONFIDENCE}`);
    console.log(`  URL           : ${URL}`);
    console.log(`  key           : ${KEY}`);
    console.log(`  prompt        : ${PROMPT}`);
    console.log(`  numPages      : ${NUMPAGES}`);
    payload = encodeFunctionData({
      abi: EXTRACT_STRING_ABI,
      functionName: "ExtractString",
      args: [ KEY, DESC, [], PROMPT, URL, RESOLVE_URL, NUMPAGES, CONFIDENCE ],
    });
  }

  // Deposit per Somnia docs: reserve + (COST_PER_AGENT * subcommitteeSize)
  // JSON API agent costs 0.03/validator; Parse/LLM cost 0.10/validator.
  const COST_PER_AGENT = AGENT === "json" ? parseEther("0.03") : parseEther("0.10");
  const BUFFER = parseEther(process.env.BUFFER ?? "0.05");
  const subSize = MODE === "advanced" ? 1n : 3n;
  const reserve = MODE === "advanced"
    ? await publicClient.readContract({ address: PLATFORM_ADDR, abi: PLATFORM_ABI, functionName: "getAdvancedRequestDeposit", args: [subSize] }) as bigint
    : await publicClient.readContract({ address: PLATFORM_ADDR, abi: PLATFORM_ABI, functionName: "getRequestDeposit" }) as bigint;
  const deposit = process.env.DEPOSIT_STT
    ? parseEther(process.env.DEPOSIT_STT)
    : reserve + COST_PER_AGENT * subSize + BUFFER;
  console.log(`  subcommittee  : ${subSize}`);
  console.log(`  reserve       : ${formatEther(reserve)} STT`);
  console.log(`  reward        : ${formatEther(COST_PER_AGENT * subSize)} STT (${formatEther(COST_PER_AGENT)} × ${subSize})`);
  console.log(`  deposit       : ${formatEther(deposit)} STT`);

  // dummy EOA callback — call to an EOA always succeeds and does nothing
  const dummyCb  = me;
  const dummySel = "0x00000000" as `0x${string}`;

  // Submit
  console.log("\n── Submitting request ─────────────────────────────────────");
  let txHash: `0x${string}`;
  if (MODE === "advanced") {
    txHash = await signer.writeContract({
      address: PLATFORM_ADDR, abi: PLATFORM_ABI, functionName: "createAdvancedRequest",
      args: [agentId, dummyCb, dummySel, payload, 1n, 1n, 0, 300n],
      value: deposit, account: signer.account, chain: undefined,
    });
  } else {
    txHash = await signer.writeContract({
      address: PLATFORM_ADDR, abi: PLATFORM_ABI, functionName: "createRequest",
      args: [agentId, dummyCb, dummySel, payload],
      value: deposit, account: signer.account, chain: undefined,
    });
  }
  console.log(`  tx: ${txHash}`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  console.log(`  mined in block ${receipt.blockNumber}, status=${receipt.status}`);

  // Extract requestId by decoding RequestCreated from THIS tx's receipt logs only
  let requestId: bigint | null = null;
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== PLATFORM_ADDR.toLowerCase()) continue;
    try {
      const decoded = decodeEventLog({ abi: PLATFORM_ABI, data: log.data, topics: log.topics as any });
      if (decoded.eventName === "RequestCreated") {
        requestId = (decoded.args as any).requestId as bigint;
        console.log(`  RequestCreated: agentId=${(decoded.args as any).agentId} perAgentBudget=${formatEther((decoded.args as any).perAgentBudget)} subcommittee=${(decoded.args as any).subcommittee.length}`);
        break;
      }
    } catch { /* not this log */ }
  }
  console.log(`  requestId: ${requestId}`);
  if (requestId === null) { console.log("  Could not determine requestId — aborting."); return; }

  // getRequest is pruned instantly post-finalization, so instead watch for the
  // RequestFinalized(requestId, status) event — the terminal outcome of THIS request.
  console.log("\n── Watching for RequestFinalized (every 5s, up to 5 min) ──");
  const finalizedEv = PLATFORM_ABI.find(x => x.name === "RequestFinalized") as any;
  const fromBlock = receipt.blockNumber;
  const start = Date.now();
  let finalStatus: number | null = null;

  while (Date.now() - start < 5 * 60 * 1000) {
    const elapsed = Math.floor((Date.now() - start) / 1000);
    const latest = await publicClient.getBlockNumber();

    // chunked scan from request block → latest, filtered by indexed requestId
    let from = fromBlock;
    let found: any = null;
    while (from <= latest) {
      const to = from + 990n > latest ? latest : from + 990n;
      const logs = await publicClient.getLogs({
        address: PLATFORM_ADDR, event: finalizedEv,
        args: { requestId }, fromBlock: from, toBlock: to,
      }).catch(() => [] as any[]);
      if (logs.length) { found = logs[logs.length - 1]; break; }
      from = to + 1n;
    }

    if (found) {
      finalStatus = Number((found.args as any).status);
      process.stdout.write("\n");
      console.log(`  [${elapsed}s] RequestFinalized: status=${finalStatus} (${RESPONSE_STATUS[finalStatus]})  block=${found.blockNumber}`);
      break;
    }
    process.stdout.write(`\r  [${elapsed}s] not finalized yet…   `);
    await sleep(5000);
  }

  process.stdout.write("\n");
  console.log("\n═══════════════════════════════════════════════════════════");
  console.log("  RESULT");
  console.log("═══════════════════════════════════════════════════════════");
  console.log(`  MODE=${MODE} resolveUrl=${RESOLVE_URL} subcommittee=${MODE === "advanced" ? 1 : 3}`);
  if (finalStatus === null)      console.log(`  → No RequestFinalized seen within 5 min (still pending or not emitted)`);
  else if (finalStatus === 2)    console.log(`  → ✅ SUCCESS — these parameters WORK`);
  else                            console.log(`  → ❌ ${RESPONSE_STATUS[finalStatus]} — these parameters FAIL`);

  console.log("\n═══════════════════════════════════════════════════════════");
}

main().catch(e => { console.error(e); process.exit(1); });
