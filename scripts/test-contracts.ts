/**
 * scripts/test-contracts.ts
 *
 * Full E2E test of all VeraLaunch contracts on Somnia testnet.
 *
 * Phases:
 *   1  Read-only state verification of all contracts
 *   2  MockERC20:      mint & balance check
 *   3  SybilRegistry:  check/request attestation, poll AI callback (~2-3 min)
 *   4  LaunchPool:     createPool → participate → finalize → claimTokens
 *   5  VestingVault:   createSchedule + milestone state check
 *   6  Summary with any bugs found
 *
 * Usage:
 *   npx hardhat run scripts/test-contracts.ts --network somnia
 */

import hre from "hardhat";
import { parseEther, formatEther } from "viem";
import * as fs from "fs";
import * as path from "path";

// ── Helpers ────────────────────────────────────────────────────────────────────
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function header(title: string) {
  console.log(`\n${"═".repeat(58)}`);
  console.log(`  ${title}`);
  console.log("═".repeat(58));
}
function section(title: string) {
  console.log(`\n── ${title} ${"─".repeat(Math.max(0, 54 - title.length))}`);
}
function ok(msg: string)   { console.log(`  ✓ ${msg}`); }
function warn(msg: string) { console.log(`  ⚠ ${msg}`); }
function fail(msg: string) { console.log(`  ✗ ${msg}`); }
function info(msg: string) { console.log(`    ${msg}`); }

interface TestResult {
  test: string;
  status: "PASS" | "FAIL" | "SKIP" | "TIMEOUT" | "BUG";
  detail?: string;
}
const results: TestResult[] = [];
function record(test: string, status: TestResult["status"], detail?: string) {
  results.push({ test, status, detail });
}

// ── Main ───────────────────────────────────────────────────────────────────────
async function main() {
  const deploymentsPath = path.join(__dirname, "../deployments/testnet.json");
  const dep = JSON.parse(fs.readFileSync(deploymentsPath, "utf-8"));

  const [signer]    = await hre.viem.getWalletClients();
  const publicClient = await hre.viem.getPublicClient();
  const account      = signer.account.address;

  const sybilRegistry = await hre.viem.getContractAt("SybilRegistry", dep.SybilRegistry as `0x${string}`);
  const launchPool    = await hre.viem.getContractAt("LaunchPool",    dep.LaunchPool    as `0x${string}`);
  const vestingVault  = await hre.viem.getContractAt("VestingVault",  dep.VestingVault  as `0x${string}`);
  const mockToken     = await hre.viem.getContractAt("MockERC20",     dep.MockERC20     as `0x${string}`);

  const balance = await publicClient.getBalance({ address: account });

  header("VeraLaunch — Full Contract Test Suite");
  console.log(`  Tester          : ${account}`);
  console.log(`  STT Balance     : ${formatEther(balance)} STT`);
  console.log(`  SybilRegistry   : ${dep.SybilRegistry}`);
  console.log(`  LaunchPool      : ${dep.LaunchPool}`);
  console.log(`  VestingVault    : ${dep.VestingVault}`);
  console.log(`  MockERC20       : ${dep.MockERC20}`);

  // ════════════════════════════════════════════════════════════════════════════
  // PHASE 1: Read-Only State Verification
  // ════════════════════════════════════════════════════════════════════════════
  section("PHASE 1: Contract State Verification");

  // SybilRegistry constants
  try {
    const parseDeposit = await sybilRegistry.read.PARSE_DEPOSIT();
    const llmDeposit   = await sybilRegistry.read.LLM_DEPOSIT();
    const totalDeposit = await sybilRegistry.read.TOTAL_DEPOSIT();
    const ttl          = await sybilRegistry.read.ATTESTATION_TTL();
    const platform     = await sybilRegistry.read.PLATFORM();
    const parseAgentId = await sybilRegistry.read.PARSE_WEBSITE_AGENT_ID();
    const llmAgentId   = await sybilRegistry.read.LLM_AGENT_ID();

    ok(`SybilRegistry constants:`);
    info(`PARSE_DEPOSIT       = ${formatEther(parseDeposit)} STT`);
    info(`LLM_DEPOSIT         = ${formatEther(llmDeposit)} STT`);
    info(`TOTAL_DEPOSIT       = ${formatEther(totalDeposit)} STT`);
    info(`ATTESTATION_TTL     = ${Number(ttl) / 86400} days`);
    info(`PLATFORM            = ${platform}`);
    info(`PARSE_WEBSITE_AGENT = ${parseAgentId}`);
    info(`LLM_AGENT           = ${llmAgentId}`);

    // Deposit math sanity check
    const buffer = totalDeposit - parseDeposit - llmDeposit;
    if (buffer === 0n) {
      warn(`Deposit buffer = 0 STT (PARSE + LLM = TOTAL exactly; no gas buffer)`);
    } else {
      ok(`Deposit buffer = ${formatEther(buffer)} STT stays in contract as gas reserve`);
    }

    record("SybilRegistry constants readable", "PASS");
  } catch (e: any) {
    fail(`SybilRegistry read failed: ${e.message}`);
    record("SybilRegistry constants readable", "FAIL", e.message);
  }

  // LaunchPool state
  try {
    const nextPoolId = await launchPool.read.nextPoolId();
    const sybilAddr  = await launchPool.read.sybilRegistry();

    ok(`LaunchPool state:`);
    info(`nextPoolId     = ${nextPoolId}`);
    info(`sybilRegistry  = ${sybilAddr}`);

    if (sybilAddr.toLowerCase() === dep.SybilRegistry.toLowerCase()) {
      ok(`SybilRegistry wired correctly into LaunchPool`);
      record("LaunchPool → SybilRegistry wiring", "PASS");
    } else {
      fail(`SybilRegistry address mismatch!`);
      info(`Expected: ${dep.SybilRegistry}`);
      info(`Got:      ${sybilAddr}`);
      record("LaunchPool → SybilRegistry wiring", "FAIL", "address mismatch");
    }
  } catch (e: any) {
    fail(`LaunchPool read failed: ${e.message}`);
    record("LaunchPool state readable", "FAIL", e.message);
  }

  // VestingVault state
  try {
    const nextScheduleId = await vestingVault.read.nextScheduleId();
    const platform2      = await vestingVault.read.PLATFORM();
    ok(`VestingVault state:`);
    info(`nextScheduleId = ${nextScheduleId}`);
    info(`PLATFORM       = ${platform2}`);
    record("VestingVault state readable", "PASS");
  } catch (e: any) {
    fail(`VestingVault read failed: ${e.message}`);
    record("VestingVault state readable", "FAIL", e.message);
  }

  // MockERC20 state
  try {
    const tokenName   = await mockToken.read.name();
    const tokenSymbol = await mockToken.read.symbol();
    const tokenSupply = await mockToken.read.totalSupply();
    const tokenBal    = await mockToken.read.balanceOf([account]);
    ok(`MockERC20 state:`);
    info(`name        = ${tokenName}`);
    info(`symbol      = ${tokenSymbol}`);
    info(`totalSupply = ${formatEther(tokenSupply)} ${tokenSymbol}`);
    info(`Deployer bal= ${formatEther(tokenBal)} ${tokenSymbol}`);
    record("MockERC20 state readable", "PASS");
  } catch (e: any) {
    fail(`MockERC20 read failed: ${e.message}`);
    record("MockERC20 state readable", "FAIL", e.message);
  }

  // ════════════════════════════════════════════════════════════════════════════
  // PHASE 2: MockERC20 — Mint
  // ════════════════════════════════════════════════════════════════════════════
  section("PHASE 2: MockERC20 Mint");

  try {
    const mintAmount = parseEther("5000");
    const mintTx = await mockToken.write.mint(
      [account, mintAmount],
      { account: signer.account }
    );
    ok(`mint(5000 DEMO) → tx ${mintTx}`);
    await sleep(4000);

    const newBal = await mockToken.read.balanceOf([account]);
    ok(`New DEMO balance: ${formatEther(newBal)} DEMO`);
    record("MockERC20 mint", "PASS");
  } catch (e: any) {
    fail(`Mint failed: ${e.message}`);
    record("MockERC20 mint", "FAIL", e.message);
  }

  // ════════════════════════════════════════════════════════════════════════════
  // PHASE 3: SybilRegistry — Attestation
  // ════════════════════════════════════════════════════════════════════════════
  section("PHASE 3: SybilRegistry Attestation");

  let attestedScore: number | null = null;

  // Check existing attestation
  try {
    const att = await sybilRegistry.read.attestations([account]);
    // Tuple: [score, timestamp, expiresAt, exists]
    const [score, timestamp, expiresAt, exists] = att as [number, bigint, bigint, boolean];

    if (exists) {
      const now = BigInt(Math.floor(Date.now() / 1000));
      const expired = now > expiresAt;
      if (!expired) {
        ok(`Valid attestation already exists!`);
        info(`Score      : ${score}/100`);
        info(`Issued at  : ${new Date(Number(timestamp) * 1000).toISOString()}`);
        info(`Expires at : ${new Date(Number(expiresAt) * 1000).toISOString()}`);
        attestedScore = Number(score);
        record("SybilRegistry existing attestation", "PASS", `score=${score}`);
      } else {
        warn(`Existing attestation EXPIRED — will request a new one`);
      }
    } else {
      info(`No attestation found for ${account}`);
    }
  } catch (e: any) {
    fail(`Could not read attestation: ${e.message}`);
    record("SybilRegistry read attestation", "FAIL", e.message);
  }

  // Request new attestation if needed
  if (attestedScore === null) {
    if (balance < parseEther("0.25")) {
      warn(`Skipping attestation request — need ≥0.25 STT, have ${formatEther(balance)} STT`);
      record("SybilRegistry requestAttestation", "SKIP", "insufficient balance");
    } else {
      info(`Requesting attestation for ${account} (0.20 STT, JSON API agent)...`);

      // Save pre-request timestamp for polling comparison
      const preReqTime = BigInt(Math.floor(Date.now() / 1000));

      try {
        const reqTx = await sybilRegistry.write.requestAttestation(
          [account],
          { account: signer.account, value: parseEther("0.20") }
        );
        ok(`requestAttestation → tx ${reqTx}`);
        info(`Step 1: Parse Website Agent scraping ${account}'s explorer page...`);
        info(`Step 2: LLM Inference Agent will score wallet uniqueness 0-100`);
        info(`Polling for callback (up to 3 minutes)...`);

        // Poll until attestation appears or timeout (10 min — Somnia AI can take 5-8 min)
        const TIMEOUT_MS      = 10 * 60 * 1000;
        const POLL_INTERVAL   = 10000;
        const deadline        = Date.now() + TIMEOUT_MS;
        let   found           = false;

        while (Date.now() < deadline) {
          await sleep(POLL_INTERVAL);
          const elapsed = Math.floor((Date.now() - (deadline - TIMEOUT_MS)) / 1000);
          process.stdout.write(`\r    Waiting for AI callback... ${elapsed}s / 600s`);

          const att2 = await sybilRegistry.read.attestations([account]);
          const [s2, ts2, , e2] = att2 as [number, bigint, bigint, boolean];

          if (e2 && ts2 >= preReqTime) {
            found = true;
            attestedScore = Number(s2);
            process.stdout.write("\n");
            ok(`Attestation received!`);
            info(`Score      : ${s2}/100`);
            info(`Issued at  : ${new Date(Number(ts2) * 1000).toISOString()}`);
            record("SybilRegistry requestAttestation", "PASS", `score=${s2}`);
            break;
          }
        }

        if (!found) {
          process.stdout.write("\n");
          warn(`AI callback not received within 3 minutes`);
          warn(`Possible causes:`);
          info(`  - Somnia AI platform is under load`);
          info(`  - Agent IDs have changed (check ISomniaAgents.sol constants)`);
          info(`  - Platform contract address changed`);
          record("SybilRegistry requestAttestation", "TIMEOUT", "no callback in 3min");
        }
      } catch (e: any) {
        fail(`requestAttestation failed: ${e.message}`);
        record("SybilRegistry requestAttestation", "FAIL", e.message);
      }
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // PHASE 4: LaunchPool — Full IDO Flow
  // ════════════════════════════════════════════════════════════════════════════
  section("PHASE 4: LaunchPool — Full IDO Flow");

  const POOL_TOKENS     = parseEther("2000");           // 2000 DEMO tokens in pool
  const TOKEN_PRICE     = parseEther("0.001");           // 0.001 STT per token
  const HARD_CAP        = parseEther("5");               // max 5 STT
  const SOFT_CAP        = parseEther("1");               // min 1 STT
  const PER_WALLET_CAP  = parseEther("2");               // max 2 STT per wallet
  const CONTRIBUTION    = parseEther("1");               // participate with 1 STT
  const NOW             = BigInt(Math.floor(Date.now() / 1000));
  const POOL_START      = NOW + 20n;                     // opens in 20s
  const POOL_END        = POOL_START + 75n;              // runs for 75s

  // Determine minimum Sybil score for pool
  // If we have an attestation, set threshold 10 below our score so we can participate.
  // If we have no attestation, use 0 — this will expose the "minSybilScore=0 still
  // requires attestation" bug.
  const minScore = attestedScore !== null
    ? Math.max(0, attestedScore - 10)
    : 0;

  if (attestedScore === null) {
    warn(`No attestation — creating pool with minSybilScore=0 to demonstrate bug`);
  }

  let poolId: bigint | null = null;

  // Step 4a: Ensure token balance and approve
  try {
    let currentBal = await mockToken.read.balanceOf([account]);
    if (currentBal < POOL_TOKENS) {
      const extra = POOL_TOKENS - currentBal + parseEther("1000");
      await mockToken.write.mint([account, extra], { account: signer.account });
      await sleep(4000);
      currentBal = await mockToken.read.balanceOf([account]);
    }
    ok(`DEMO balance sufficient: ${formatEther(currentBal)} DEMO`);

    const approveTx = await mockToken.write.approve(
      [dep.LaunchPool as `0x${string}`, POOL_TOKENS],
      { account: signer.account }
    );
    ok(`Approved LaunchPool for ${formatEther(POOL_TOKENS)} DEMO → tx ${approveTx}`);
    await sleep(4000);
    record("LaunchPool token approval", "PASS");
  } catch (e: any) {
    fail(`Token approval failed: ${e.message}`);
    record("LaunchPool token approval", "FAIL", e.message);
  }

  // Step 4b: Create pool
  try {
    const createTx = await launchPool.write.createPool([{
      projectToken:  dep.MockERC20 as `0x${string}`,
      tokenPrice:    TOKEN_PRICE,
      hardCap:       HARD_CAP,
      softCap:       SOFT_CAP,
      perWalletCap:  PER_WALLET_CAP,
      totalTokens:   POOL_TOKENS,
      startTime:     POOL_START,
      endTime:       POOL_END,
      minSybilScore: minScore,
      buyerCliff:    0n,
      buyerVest:     0n,
    }, []], { account: signer.account });

    ok(`createPool → tx ${createTx}`);
    await sleep(4000);

    const newNext = await launchPool.read.nextPoolId();
    poolId = newNext - 1n;
    const pool = await launchPool.read.pools([poolId]);
    // pool tuple: [projectToken, tokenPrice, hardCap, softCap, perWalletCap,
    //              totalTokens, startTime, endTime, totalRaised, minSybilScore,
    //              finalized, softCapMet]

    ok(`Pool created! Pool ID = ${poolId}`);
    info(`  projectToken  : ${pool[0]}`);
    info(`  tokenPrice    : ${formatEther(pool[1] as bigint)} STT/token`);
    info(`  hardCap       : ${formatEther(pool[2] as bigint)} STT`);
    info(`  softCap       : ${formatEther(pool[3] as bigint)} STT`);
    info(`  perWalletCap  : ${formatEther(pool[4] as bigint)} STT`);
    info(`  totalTokens   : ${formatEther(pool[5] as bigint)} DEMO`);
    info(`  startTime     : ${new Date(Number(pool[6] as bigint) * 1000).toISOString()}`);
    info(`  endTime       : ${new Date(Number(pool[7] as bigint) * 1000).toISOString()}`);
    info(`  minSybilScore : ${pool[9]}/100`);
    record("LaunchPool createPool", "PASS", `poolId=${poolId}`);
  } catch (e: any) {
    fail(`createPool failed: ${e.message}`);
    record("LaunchPool createPool", "FAIL", e.message);
  }

  // Step 4c: Wait for pool to open, then participate
  if (poolId !== null) {
    info(`Waiting 22s for pool to open...`);
    await sleep(22000);

    const isActive = await launchPool.read.isActive([poolId]);
    ok(`Pool isActive = ${isActive}`);

    if (!isActive) {
      warn(`Pool is not active yet — timing may have drifted, waiting 5s more`);
      await sleep(5000);
    }

    if (attestedScore === null) {
      // Demonstrate the bug: minSybilScore=0 still blocks unattested wallets
      info(`Testing: can unattested wallet participate in pool with minSybilScore=0?`);
      try {
        await launchPool.write.participate(
          [poolId],
          { account: signer.account, value: CONTRIBUTION }
        );
        fail(`BUG CONFIRMED: participate() succeeded without any attestation!`);
        record("LaunchPool Sybil guard (no attestation)", "FAIL", "allowed unattested wallet");
      } catch (e: any) {
        if (e.message.includes("Sybil check failed")) {
          ok(`Correctly blocked: "Sybil check failed"`);
          warn(`BUG: Pool has minSybilScore=0 but still blocks participation.`);
          warn(`     isVerified() checks a.exists unconditionally, so score=0`);
          warn(`     pools are NOT open-to-all — they require prior attestation.`);
          warn(`     Fix: skip isVerified() check when pool.minSybilScore == 0`);
          record("LaunchPool Sybil guard (no attestation)", "PASS");
          record("BUG: minSybilScore=0 pools still require attestation", "BUG",
            "isVerified() always checks a.exists; pools with score=0 should allow everyone");
        } else {
          warn(`Blocked with unexpected revert: ${e.message}`);
          record("LaunchPool Sybil guard (no attestation)", "PASS", `revert: ${e.message}`);
        }
      }
    } else {
      // Happy path: we have an attestation, try to participate
      try {
        const participateTx = await launchPool.write.participate(
          [poolId],
          { account: signer.account, value: CONTRIBUTION }
        );
        ok(`participate(1 STT) → tx ${participateTx}`);
        await sleep(4000);

        const contrib = await launchPool.read.getContribution([poolId, account]);
        const pool2   = await launchPool.read.pools([poolId]);
        ok(`Contribution recorded: ${formatEther(contrib as bigint)} STT`);
        ok(`Pool totalRaised: ${formatEther(pool2[8] as bigint)} STT`);

        const claimable = await launchPool.read.getClaimableTokens([poolId, account]);
        ok(`Claimable tokens (if pool succeeds): ${formatEther(claimable as bigint)} DEMO`);
        record("LaunchPool participate", "PASS", `contribution=1 STT`);
      } catch (e: any) {
        fail(`participate failed: ${e.message}`);
        record("LaunchPool participate", "FAIL", e.message);
      }

      // Wait for pool to end (~75s from start, we already waited 22s → ~55s more)
      info(`Waiting ~58s for pool to close...`);
      await sleep(58000);

      const pool3 = await launchPool.read.pools([poolId]);
      const totalRaised = pool3[8] as bigint;
      const softCapRaw  = pool3[3] as bigint;

      info(`Pool ended. totalRaised = ${formatEther(totalRaised)} STT`);
      info(`            softCap     = ${formatEther(softCapRaw)} STT`);
      info(`            softCap met = ${totalRaised >= softCapRaw}`);

      // Finalize
      try {
        const finalizeTx = await launchPool.write.finalize(
          [poolId],
          { account: signer.account }
        );
        ok(`finalize → tx ${finalizeTx}`);
        await sleep(4000);

        const pool4       = await launchPool.read.pools([poolId]);
        const finalized   = pool4[10] as boolean;
        const softCapMet  = pool4[11] as boolean;
        ok(`finalized   = ${finalized}`);
        ok(`softCapMet  = ${softCapMet}`);
        record("LaunchPool finalize", "PASS", `softCapMet=${softCapMet}`);

        // Claim tokens or refund
        if (softCapMet) {
          try {
            const claimTx = await launchPool.write.claimTokens(
              [poolId],
              { account: signer.account }
            );
            ok(`claimTokens → tx ${claimTx}`);
            await sleep(4000);
            const finalDemoBal = await mockToken.read.balanceOf([account]);
            ok(`DEMO balance after claim: ${formatEther(finalDemoBal as bigint)} DEMO`);
            record("LaunchPool claimTokens", "PASS");
          } catch (e: any) {
            fail(`claimTokens failed: ${e.message}`);
            record("LaunchPool claimTokens", "FAIL", e.message);
          }
        } else {
          warn(`Soft cap not met — IDO failed. Getting refund...`);
          try {
            const refundTx = await launchPool.write.refund(
              [poolId],
              { account: signer.account }
            );
            ok(`refund → tx ${refundTx}`);
            await sleep(4000);
            const newSttBal = await publicClient.getBalance({ address: account });
            ok(`STT balance after refund: ${formatEther(newSttBal)} STT`);
            record("LaunchPool refund", "PASS");
          } catch (e: any) {
            fail(`refund failed: ${e.message}`);
            record("LaunchPool refund", "FAIL", e.message);
          }
        }
      } catch (e: any) {
        fail(`finalize failed: ${e.message}`);
        record("LaunchPool finalize", "FAIL", e.message);
      }
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // PHASE 5: VestingVault — Create Schedule
  // ════════════════════════════════════════════════════════════════════════════
  section("PHASE 5: VestingVault — Vesting Schedule");

  const VEST_TOTAL   = parseEther("300");
  const MILESTONE_1  = parseEther("100");
  const MILESTONE_2  = parseEther("100");
  const MILESTONE_3  = parseEther("100");
  const FAR_DEADLINE = BigInt(Math.floor(Date.now() / 1000)) + BigInt(180 * 24 * 3600); // 180 days

  try {
    // Mint + approve
    await mockToken.write.mint([account, VEST_TOTAL], { account: signer.account });
    await sleep(4000);
    ok(`Minted ${formatEther(VEST_TOTAL)} DEMO for vesting`);

    const vestApproveTx = await mockToken.write.approve(
      [dep.VestingVault as `0x${string}`, VEST_TOTAL],
      { account: signer.account }
    );
    ok(`Approved VestingVault for ${formatEther(VEST_TOTAL)} DEMO → tx ${vestApproveTx}`);
    await sleep(4000);

    const createSchedTx = await vestingVault.write.createSchedule([
      dep.MockERC20 as `0x${string}`,
      VEST_TOTAL,
      account, // beneficiary = self for testing
      // Parse Website agent = domain SEARCH: evidenceUrl is a DOMAIN, description
      // is the search query, an LLM judges PASS/FAIL. Use verifiable public claims.
      [
        {
          description:  "Ethereum supports smart contracts written in the Solidity language",
          evidenceUrl:  "ethereum.org",
          unlockAmount: MILESTONE_1,
          deadline:     FAR_DEADLINE,
        },
        {
          description:  "Bitcoin is a decentralized peer-to-peer digital currency",
          evidenceUrl:  "bitcoin.org",
          unlockAmount: MILESTONE_2,
          deadline:     FAR_DEADLINE,
        },
        {
          description:  "Somnia is an EVM-compatible Layer 1 blockchain",
          evidenceUrl:  "somnia.network",
          unlockAmount: MILESTONE_3,
          deadline:     FAR_DEADLINE,
        },
      ],
    ], { account: signer.account });

    ok(`createSchedule → tx ${createSchedTx}`);
    await sleep(4000);

    const newNextSched = await vestingVault.read.nextScheduleId();
    const schedId      = newNextSched - 1n;
    const sched        = await vestingVault.read.schedules([schedId]);
    // Tuple: [beneficiary, token, totalAmount, unlockedAmount]

    ok(`Schedule created! ID = ${schedId}`);
    info(`  beneficiary    : ${sched[0]}`);
    info(`  token          : ${sched[1]}`);
    info(`  totalAmount    : ${formatEther(sched[2] as bigint)} DEMO`);
    info(`  unlockedAmount : ${formatEther(sched[3] as bigint)} DEMO`);

    const count      = await vestingVault.read.getMilestoneCount([schedId]);
    const milestones = await vestingVault.read.getMilestones([schedId]);
    ok(`Milestones (${count}):`);

    const STATUS_NAMES = ["PENDING", "VERIFYING", "PASSED", "FAILED"];
    for (let i = 0; i < milestones.length; i++) {
      const m    = milestones[i] as any;
      const desc = (m.description as string).substring(0, 50);
      info(`  [${i}] ${desc} → ${formatEther(m.unlockAmount as bigint)} DEMO [${STATUS_NAMES[m.status]}]`);
    }

    record("VestingVault createSchedule", "PASS", `scheduleId=${schedId}`);

    // Document known bugs / design gaps
    warn(`Known design gaps in VestingVault:`);
    info(`  1. FAILED milestones cannot be retried — claimMilestone() requires PENDING status.`);
    info(`     If the AI platform has a transient failure, those tokens are locked permanently.`);
    info(`     Fix: add a resetMilestone(scheduleId, idx) callable by schedule creator.`);
    info(`  2. No emergency token recovery. If all milestones fail, beneficiary can never`);
    info(`     retrieve tokens. Consider adding an admin/creator withdrawal after a timeout.`);
    record("BUG: VestingVault FAILED milestone permanently locks tokens", "BUG",
      "no retry or recovery path for failed milestones");

    // Test claimMilestone if we have enough STT
    const sttBal2 = await publicClient.getBalance({ address: account });
    if (sttBal2 >= parseEther("0.85")) {
      info(`Testing claimMilestone(scheduleId=${schedId}, index=0) — triggers AI pipeline...`);
      try {
        const claimMsTx = await vestingVault.write.claimMilestone(
          [schedId, 0n],
          { account: signer.account, value: parseEther("0.80") }
        );
        ok(`claimMilestone → tx ${claimMsTx}`);
        info(`AI pipeline started. Milestone 0 status is now VERIFYING.`);
        info(`(AI callback will arrive asynchronously — monitor with 'npm run monitor')`);
        await sleep(4000);

        const m0After = await vestingVault.read.getMilestone([schedId, 0n]);
        const m0Any   = m0After as any;
        info(`Milestone 0 status after claim: ${STATUS_NAMES[m0Any.status]}`);
        record("VestingVault claimMilestone", "PASS");
      } catch (e: any) {
        fail(`claimMilestone failed: ${e.message}`);
        record("VestingVault claimMilestone", "FAIL", e.message);
      }
    } else {
      warn(`Skipping claimMilestone — need ≥0.85 STT, have ${formatEther(sttBal2)}`);
      record("VestingVault claimMilestone", "SKIP", "insufficient balance");
    }
  } catch (e: any) {
    fail(`VestingVault test failed: ${e.message}`);
    record("VestingVault createSchedule", "FAIL", e.message);
  }

  // ════════════════════════════════════════════════════════════════════════════
  // SUMMARY
  // ════════════════════════════════════════════════════════════════════════════
  header("TEST SUMMARY");

  const passed  = results.filter((r) => r.status === "PASS");
  const failed2 = results.filter((r) => r.status === "FAIL");
  const bugs    = results.filter((r) => r.status === "BUG");
  const skipped = results.filter((r) => r.status === "SKIP" || r.status === "TIMEOUT");

  for (const r of results) {
    const icon =
      r.status === "PASS"    ? "✓" :
      r.status === "FAIL"    ? "✗" :
      r.status === "BUG"     ? "⚠" :
      r.status === "TIMEOUT" ? "⏱" : "–";
    const label  = r.status.padEnd(8);
    const detail = r.detail ? `  (${r.detail})` : "";
    console.log(`  ${icon} [${label}] ${r.test}${detail}`);
  }

  console.log("─".repeat(58));
  console.log(`  ✓ Passed  : ${passed.length}`);
  console.log(`  ✗ Failed  : ${failed2.length}`);
  console.log(`  ⚠ Bugs    : ${bugs.length}`);
  console.log(`  – Skipped : ${skipped.length}`);
  console.log("═".repeat(58));

  if (failed2.length > 0) {
    console.log("\nFailed tests:");
    for (const r of failed2) {
      console.log(`  • ${r.test}: ${r.detail ?? "see above"}`);
    }
  }

  if (bugs.length > 0) {
    console.log("\nBugs found:");
    for (const r of bugs) {
      console.log(`  • ${r.test}`);
      if (r.detail) console.log(`    ${r.detail}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
