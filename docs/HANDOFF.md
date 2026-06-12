# Latch — Project Handoff / Context

Read this first. It is the single source of truth for what Latch is, what's built, where
everything lives, and what's next. Written for a fresh session to continue without re-deriving.

---

## 1. What Latch is

**A verifiable settlement layer for agent commerce on Avalanche.** When one agent pays another,
existing escrow releases on *shape* (valid JSON, no 5xx) — a provider that returns well-formed
garbage still gets paid. Latch releases only against a real, **evidence-backed correctness verdict**
from a **staked verifier committee**, consumed by an ERC-8183-style escrow. The defensible IP is the
verifier (substance checks) + the optimistic, slashing-backed settlement around it.

For the **Avalanche "Agentic Payments" Speedrun** (theme: agents paying agents). Built to a
production bar, not an MVP toy: hostile-judge / investor review expected.

One-line pitch: *"Latch is the trust-and-settlement rail for the agent economy — we take a small cut
of every transaction we make safe, and we run the staked network that decides what 'safe' means."*

---

## 2. Status — what's done (all live on Fuji)

| Area | State | Proof |
|---|---|---|
| Escrow contracts + lifecycle | done | 55 Solidity tests (unit+fuzz+invariant), Slither clean, Aderyn 0-high |
| Rust verifier (policies, EIP-712 signing, evidence) | done | cross-language golden vector + tests |
| Staked verifier committee (k-of-n quorum, stake, slash) | done | live on Fuji |
| x402 (real HTTP 402 + EIP-3009 settlement; we are the facilitator) | done | live on Fuji |
| Autonomous agents (buyer + honest/adversarial providers) | done | live on Fuji |
| ERC-8004 (identity + reputation, real Fuji registries) | done | two-provider reputation demo live |
| Frontend landing (Swiss/technical design) | done | web/ |
| Frontend Explorer (n8n-style per-job workflow tree) | done | /explorer |

**~72% toward a polished, judge-ready submission.** The hard/novel ~80% is done.

### What's NOT done (next)
1. **One-click "Run a live job"** — a button on the site that triggers a real agent job on Fuji and
   streams it into the Explorer live (small backend wrapping the agent orchestrator + frontend SSE).
   *This is the next thing to build.*
2. Connect-wallet "post your own job" + agent SDK/docs page.
3. Recording, merge `staked-committee` -> `main`, docs/threat-model pass.

---

## 3. Where it lives + how to run

- **Filesystem:** WSL distro `UbuntuFixed`, repo root `/home/divyanshh1/latch`
  (Windows UNC: `\\wsl.localhost\UbuntuFixed\home\divyanshh1\latch`). Foundry/cargo/anvil run in WSL.
- **Git:** remote `github.com/TechnicallyKiller/Latch-SpeedRun`. Active branch **`staked-committee`**
  (NOT merged to main). `main` = the pre-committee working demo, tagged **`v0.1-fuji-demo`** (safety
  restore point). Commits land on `staked-committee`; user controls merges; NO Claude attribution in
  commits/PRs.
- **Env:** repo-root `.env` (gitignored) + `.env.example` (template, tracked). Vars: `FUJI_RPC_URL`
  (user's Alchemy key), `CHAIN_ID=43113`, `USDC_ADDRESS`, `LATCHJOB_ADDRESS`,
  `{DEPLOYER,BUYER,PROVIDER,PROVIDER2,VERIFIER}_PRIVATE_KEY`, `PINATA_JWT`, `JOB_AMOUNT=5000`
  (0.005 USDC), `PROVIDER_BOND=1000`, `CHALLENGE_BOND=1000`, `PROTOCOL_FEE_BPS=100`,
  `CHALLENGE_WINDOW=60`.

### Run commands (PATH must include `$HOME/.cargo/bin` and/or `$HOME/.foundry/bin`)
```
# contracts
cd contracts && forge test                    # 55 tests
forge script script/DeployFuji.s.sol:DeployFuji --rpc-url <fuji> --broadcast   # (re)deploy

# verifier
cd verifier && cargo test                      # 8 tests
cargo test --test e2e_anvil -- --ignored       # live anvil e2e (needs anvil)
cargo run --bin fuji_demo -- pass|fail         # live Fuji single-loop demo

# agents (real x402 + ERC-8004, live on Fuji)
cd agents && npm run demo                       # single honest agent loop
npm run reputation-demo                         # two competing providers, reputation-picked

# web
cd web && npm run dev                           # http://localhost:5173  (/ landing, /explorer)
```

---

## 4. Key on-chain facts (verified live, do not assume)

- Avalanche **Fuji** chainId **43113**, RPC `https://api.avax-test.network/ext/bc/C/rpc`
  (public; caps `eth_getLogs` at 2048 blocks). C-Chain mainnet 43114.
- **USDC (Fuji)** `0x5425890298aed601595a70AB815c96711a31Bc65` — FiatTokenV2, EIP-3009, EIP-712
  domain name "USD Coin" version "2".
- **LatchJob (committee, current)** `0xa5cA9c7920F22E1104215C430227756dEBBb2a09` (deploy block
  56169334). Pre-committee LatchJob `0xD7EeD2a64762A7038d64886882161bA1b1EfC074` (main's demo).
- **ERC-8004 (Fuji, canonical, final-spec ABI verified live):** Identity
  `0x8004A818BFB912233c491871b3d84c89A494BD9e`, Reputation
  `0x8004B663056A597Dffe9eCcC1965A193B7388713`. (Validation registry not deployed anywhere.)
- **Verifier key (staked, active)** `0x364EDC06254874e62FF4AD8fA4d9a45238cb5609`.
  **PROVIDER2 (adversarial)** `0x3980c81a58462C72443fd60Fc070C977C7E5A275`.
- ERC-8183 is a draft; Latch implements a compatible job/escrow, not a dependency.

---

## 5. Architecture tree

```
latch/
├── contracts/                      Foundry · solc 0.8.31 · OZ v5.6.1
│   ├── src/
│   │   ├── LatchJob.sol            ESCROW + lifecycle + STAKED VERIFIER COMMITTEE
│   │   │                           (createJob / fundJob[EIP-3009] / acceptJob / submitDeliverable
│   │   │                            / submitVerdict[bytes[] k-of-n quorum] / finalize / challenge
│   │   │                            / resolveDispute / timeoutRefund; stakeVerifier/unstakeVerifier;
│   │   │                            slash on overturned verdict; pull-payment withdraw)
│   │   ├── BondModule.sol          pull-payment ledger + bond accounting (ERC-4626 seam)
│   │   ├── mocks/MockUSDC.sol      FiatTokenV2-equivalent EIP-3009 (LOCAL/anvil tests ONLY)
│   │   └── interfaces/             IERC3009.sol, IERC8004.sol
│   ├── test/                       Base.t.sol, LatchJob.t.sol (unit+staking+quorum),
│   │                               LatchJobFuzz.t.sol, VerdictDigest.t.sol, invariant/
│   └── script/                     DeployFuji.s.sol, FundVerifier.s.sol
│
├── verifier/                       Rust · alloy · the CORE IP
│   ├── src/
│   │   ├── policy/                 mod.rs (Policy trait), json_schema.rs (shape),
│   │   │                           ground_truth.rs (substance, commit-reveal)
│   │   ├── verdict.rs              EIP-712 Verdict signing (byte-matches LatchJob)
│   │   ├── evidence.rs             content-addressed evidence (LocalCas; Pinata in fuji_demo)
│   │   ├── chain.rs                submit_verdict() -> LatchJob.submitVerdict (bytes[] sigs)
│   │   ├── canonical.rs            deterministic JSON for commitments
│   │   ├── lib.rs                  run_verification() (enforces commit-reveal)
│   │   └── bin/                    fuji_demo.rs (full loop), agent_verify.rs (verifier worker:
│   │                               `commitment` | `submit <jobId> <deliverable.json>`)
│   └── tests/                      verification.rs (incl golden vector), e2e_anvil.rs
│
├── agents/                         TypeScript · viem + express · the AGENTIC layer
│   ├── src/
│   │   ├── shared/
│   │   │   ├── config.ts           loads .env, viem clients, keys, amounts
│   │   │   ├── abi.ts              LatchJob + USDC ABIs (viem)
│   │   │   ├── eip3009.ts          signs USDC ReceiveWithAuthorization (the x402 payment)
│   │   │   ├── x402.ts             x402 types + encode/decode (exact/EIP-3009 scheme)
│   │   │   ├── erc8004.ts          register / reputationOf / giveFeedback (real registries)
│   │   │   └── verifier-runner.ts  shells out to the Rust agent_verify bin
│   │   ├── facilitator.ts          x402 settle() -> LatchJob.fundJob (we are the facilitator)
│   │   ├── provider.ts             provider agent: agent-card + x402-gated /hire (parameterized
│   │   │                           by key/mode/agentId; honest vs adversarial)
│   │   ├── buyer.ts                buyer agent: createJob + x402 client + finalizeAndWithdraw
│   │   ├── demo.ts                 single honest loop orchestrator
│   │   └── reputation-demo.ts      TWO competing providers, reputation-picked (headline)
│
└── web/                            Vite + React + TS · viem · react-router · Swiss design
    └── src/
        ├── App.tsx                 landing (Hero/Gap/Loop/Trust/Model) + routing
        ├── pages/Explorer.tsx      /explorer — n8n workflow tree, 2 real jobs (PASS/FAIL toggle)
        ├── components/             Workflow.tsx (node graph), NodeDetail.tsx (click -> code map)
        ├── chain.ts                STATIC real job data (hardcoded real tx hashes; no chain scan)
        ├── lifecycle.ts            step/node defs + per-node explanation + code refs (Rust->Sol->TS)
        └── index.css               bespoke Swiss design system (black + Avalanche red, mono data)
```

---

## 6. How the pieces connect (the live loop)

```
BuyerAgent.createJob -> provider /hire returns HTTP 402 -> buyer signs EIP-3009 (X-PAYMENT)
   -> facilitator.settle -> LatchJob.fundJob (escrow funded)            [x402]
   -> provider acceptJob(bond) + does work + submitDeliverable
   -> agent_verify (Rust): GroundTruthPolicy.evaluate -> EIP-712 verdict -> chain.submit_verdict
        (LatchJob.submitVerdict: k-of-n staked quorum; opens challenge window)
   -> finalize -> PASS: pay provider (-fee) ; FAIL: refund buyer + slash provider bond
   -> buyer writes ERC-8004 feedback (reputation moves) -> next job: buyer picks by reputation
   (overturned dispute -> slash every verifier that signed)
```

---

## 7. Gotchas / hard-won lessons (IMPORTANT)

- **WSL `$VAR` stripping:** in `wsl -d UbuntuFixed -- bash -c '...'`, shell variables in the command
  TEXT that are set DURING the script (by `source`, loops, command-substitution) expand to EMPTY
  before the script runs. Pre-existing env (`$HOME`, `$PATH`) expands fine. Fixes: pass LITERAL
  values (e.g. `--rpc-url "https://..."`, not `"$FUJI_RPC_URL"`); let forge read sourced env via
  `vm.envUint`; Rust bins load `.env` via `dotenvy`; avoid awk single-quotes inside; use full paths
  (e.g. `/home/divyanshh1/.foundry/bin/cast`).
- **Rust build times:** first full alloy compile ~11 min (one-time); incremental (our crate) ~1-1.5
  min. Builds are I/O-bound in WSL; mold/lld not installed and no passwordless sudo. Run long builds
  in the background.
- **eth_getLogs limits:** public Fuji RPC caps at **2048 blocks**; Alchemy **free** tier caps at
  **10 blocks**. So the web Explorer uses STATIC hardcoded real tx hashes (instant) instead of
  scanning history. For NEW jobs (one-click run / post-a-job), watch only the live edge from the
  current block for that one jobId — never re-scan history.
- **WSL VM occasionally errors** `0x800705aa Insufficient system resources` (low host memory) — retry,
  or do filesystem ops via the Windows UNC path / PowerShell instead of spawning a new WSL instance.
- **Foundry verifier-params:** committee `LatchJob` constructor is unchanged; owner must call
  `setVerifierParams(minStake, slashPerVerdict, quorum)` and verifiers must `stakeVerifier`. Deploy
  script does the former; `fuji_demo`/`reputation-demo` stake the verifier(s).

---

## 8. Next task (in progress): one-click "Run a live job"

Goal: a button on the site (or `/explorer`) that triggers a REAL agent job on Fuji and streams it
into the Explorer live, node-by-node, with Snowtrace links — no wallet needed (runs on our funded
demo accounts), rate-limited so it can't be drained.

Plan:
1. Small backend (Node/express) in `agents/` exposing `POST /api/run` (honest|fail) that runs the
   orchestrator and streams steps via SSE (`{ step, tx }` events). Reuse buyer.ts / provider.ts /
   verifier-runner.ts. Rate-limit + tiny amounts.
2. Frontend: a "Run a live job" control that opens the SSE stream, adds a new job to the Explorer,
   and lights up nodes as each `tx` arrives (the lifecycle tree already exists in `lifecycle.ts`).
3. Keep the static example jobs as the always-present default.

Then: recording, merge to `main`, short docs pass.
