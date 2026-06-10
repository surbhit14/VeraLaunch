# VeraLaunch

**The token launchpad that runs itself.**

An autonomous, AI-verified launchpad on the [Somnia](https://somnia.network) Agentic L1.
Somnia's on-chain consensus AI makes every decision — verifying real humans, vetting projects,
and releasing a team's raise *only* when it confirms a real milestone shipped — and an autonomous
keeper agent operates the whole protocol with **no admin in the loop**.

### 🔗 Live demo: **https://veralaunch-surbhit14s-projects.vercel.app**
Agent manifest: `https://veralaunch-surbhit14s-projects.vercel.app/.well-known/agent.json`

> Most launches ask you to trust the team. VeraLaunch asks you to trust nobody:
> the AI guards the money, and the protocol runs itself.

---

## The problem

Every token launch has two trust gaps:

1. **Investor side** — bots spin up hundreds of wallets to sweep an allocation, so per-wallet caps are meaningless.
2. **Team side** — teams take the raise up front and promise to build, then vanish.

VeraLaunch closes both with on-chain AI, and removes the operator entirely.

## What it does

### For investors (buy side)
- **Swipe-to-invest feed** built for small retail — browse live launches, back one in two taps.
- **AI Sybil gate** — a multi-signal score (on-chain activity **+** real STT balance) keeps bot armies out, so caps mean *per-human*.
- **AI project-trust score** — an LLM agent rates each project's legitimacy 0–100 from its site, shown on every card.

### For teams (sell side)
- **Milestone-gated treasury** — the raise is **escrowed**, not handed over. Somnia's AI releases it in tranches only when it verifies a real milestone from public evidence. If the team fails, investors **claw back** the rest.
- **Buyer vesting** — purchased tokens can vest (cliff + linear) to prevent dump-and-run.

### The autonomy layer (the differentiator)
- An **autonomous keeper agent** continuously discovers ended sales and due milestones and invokes the AI — finalizing, verifying, scoring — with no human input. It even **self-heals** (re-scores failed AI calls).
- **Permissionless** — sale finalization is callable by anyone, so an open set of keepers can run the protocol.
- **Agent-discoverable** — any other agent can read `/.well-known/agent.json` and invoke every action. A live proof ships in `npm run agent:external`.

## The four AI agents

| Agent | Somnia primitive | Decides |
|---|---|---|
| **Sybil score** | JSON API agent | Each wallet's humanness (tx count + STT balance) → IDO access |
| **Project trust** | Parse Website + LLM | Each project's legitimacy 0–100 → shown to buyers |
| **Milestone verifier** | Parse Website + LLM | Whether a real-world milestone shipped → releases escrow / vests tokens |
| **Keeper** | off-chain operator agent | Discovers state and invokes the others — runs the protocol |

## Contracts (Somnia testnet, chainId 50312 — all source-verified)

| Contract | Address | Verified |
|---|---|---|
| SybilRegistry | `0x465303a0bd8668e144913dba8e7f4f7655b58500` | [↗](https://somnia.w3us.site/address/0x465303a0bd8668e144913dba8e7f4f7655b58500#code) |
| VestingVault | `0x88d6df61b96ceb36065bca3d27e423bfa8578710` | [↗](https://somnia.w3us.site/address/0x88d6df61b96ceb36065bca3d27e423bfa8578710#code) |
| LaunchPool | `0x36754cde2259b00f99c050ba07262e40b89dc3aa` | [↗](https://somnia.w3us.site/address/0x36754cde2259b00f99c050ba07262e40b89dc3aa#code) |
| TrustOracle | `0x9d4efc0305153231027e729b5de6f58b0973ff18` | [↗](https://somnia.w3us.site/address/0x9d4efc0305153231027e729b5de6f58b0973ff18#code) |
| MockERC20 | `0x55fc873724a0cc70bf9ec121843dbef409e8c137` | [↗](https://somnia.w3us.site/address/0x55fc873724a0cc70bf9ec121843dbef409e8c137#code) |

Machine-readable manifest: [`/.well-known/agent.json`](frontend/public/.well-known/agent.json)

## Tech stack
- **Contracts:** Solidity 0.8.24 (viaIR), Hardhat, OpenZeppelin, Somnia agent platform.
- **Frontend:** React + Vite + TypeScript, wagmi/viem, Tailwind. Mobile-first (swipe feed + bottom tab bar).
- **Agents:** off-chain keeper + external-agent scripts (Hardhat + viem).

## Run it locally

```sh
# 1. setup
npm install
cp .env.example .env          # add a funded Somnia-testnet PRIVATE_KEY
npm run compile

# 2. (optional) deploy your own + seed demo data
npm run deploy                # writes deployments/testnet.json
npm run seed                  # 4 demo launches (gating / vesting / escrow / trust)

# 3. the autonomous keeper — leave it running
npm run keeper

# 4. the UI
cd frontend && npm install && npm run dev   # http://localhost:5173
```

**See it operate itself:** open the **Agents** tab, then run `npm run demo` (drops a short-lived
treasury pool) and watch the keeper finalize it and invoke the AI to release the escrow — live.

**Prove external agents can use it:** `npm run agent:external` — a third-party agent discovers the
protocol from the manifest and autonomously backs a launch.

## Verification
All contracts are source-verified on `somnia.w3us.site` (the Blockscout instance that indexes this
chain and handles the viaIR build). Recipe + commands in [`VERIFY.md`](VERIFY.md).

## How it maps to the judging criteria
- **Functionality** — deployed + source-verified on Somnia testnet; every mechanic proven on-chain (`npm run test:sybil`, `test:vesting`, `test:launchpad`).
- **Agent-First Design** — four AI agents decide; manifest + `agent:external` prove third-party discovery & invocation; permissionless operation.
- **Innovation** — AI-verified milestone-gated treasury + clawback, AI project-trust oracle, multi-signal Sybil score.
- **Autonomous Performance** — the keeper runs the whole protocol unattended and self-heals; the Agents tab shows it live.

## Docs
- [`DEMO.md`](DEMO.md) — full demo runbook
- [`DEMO-VIDEO.md`](DEMO-VIDEO.md) — shot-by-shot video script
- [`VERIFY.md`](VERIFY.md) — contract verification

---

Built for the Somnia Agentic L1. 🤖
