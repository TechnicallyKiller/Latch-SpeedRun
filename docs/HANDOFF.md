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
| Frontend Business page (full revenue/economics/risks) | done | /business |
| Frontend Docs page (how-it-works + real-world) | done | /docs |
| **One-click "Run a live job"** (SSE backend + live tree) | done | `agents/src/server.ts` + Explorer run-bar; real Fuji jobs stream node-by-node |
| **Judge-as-buyer wallet flow** (connect → sign → withdraw) | done | `/post` + `agents/src/judge.ts` + `/api/judge-run`; judge funds with own USDC, refund to own wallet |
| **Real AI provider agents** (honest vs confidently-wrong) | done | `agents/src/shared/ai.ts` `work()`; Groq Llama 3.3 (free) or Claude Haiku, deterministic fallback |

**~90% toward a polished, judge-ready submission.** The hard/novel work + the two interactive flows
are done; what's left is hosting + recording, not new protocol.

### What's NOT done (next)
1. **Host the live-run backend publicly (the one remaining build).** Both interactive flows work
   locally but the frontend hits `SERVER` = `import.meta.env.VITE_LIVE_RUN_URL ?? "http://localhost:4030"`
   (`web/src/pages/Explorer.tsx`, imported by `/post`). For the deployed site, run `agents/src/server.ts`
   on a public host (Railway / Render / Fly / a small VM) with the funded demo `.env` (incl. GROQ_API_KEY),
   and set `VITE_LIVE_RUN_URL` in the site build env. CORS is already `*`.
2. **Smoke-test the full `/post` flow against Fuji in a browser** (connect wallet → scammer → withdraw
   refund). Verified locally up to typecheck/build + a curl `/api/run`, but the 3-wallet-pop path needs
   a real injected wallet. Demo accounts must hold a little AVAX + USDC (the `/api/faucet` drips from
   DEPLOYER/BUYER).
3. Agent SDK page (optional); recording; merge `staked-committee` -> `main`; docs/threat-model pass.

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
  `CHALLENGE_WINDOW=60`. **Optional AI keys** (picked in this order by `agents/src/shared/ai.ts`):
  `GROQ_API_KEY` (free, no card, console.groq.com → Llama 3.3 70B) → `ANTHROPIC_API_KEY` (Claude
  Haiku) → deterministic fallback. User currently has `GROQ_API_KEY` set, so real AI agents are live.

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
npm run server                                  # live-run SSE backend on :4030 (the one-click run)
                                                #   GET /api/run?mode=honest|fail -> streams step events
                                                #   boots provider gateways on :4021/:4022; one job at a time

# web
cd web && npm run dev                           # http://localhost:5173  (/ landing, /explorer, /business)
#   NOTE: the Explorer's "Run a live job" needs `npm run server` (agents) running on :4030.
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
│   │   ├── reputation-demo.ts      TWO competing providers, reputation-picked (headline)
│   │   ├── server.ts               LIVE-RUN SSE backend (:4030) — the one-click run; boots provider
│   │   │                           gateways on :4021/:4022 (both use funded PROVIDER key), one job
│   │   │                           at a time, GET /api/run?mode=honest|fail streams step events
│   │   └── live.ts                 runLiveJob(): one real Fuji job emitting create/fund/accept/submit/
│   │                               verify/verdict/finalize/outcome; tops provider USDC from buyer if a
│   │                               prior FAIL slashed its bond
│
└── web/                            Vite + React + TS · viem · react-router · Swiss design
    └── src/
        ├── App.tsx                 landing (Hero/Gap/Loop/Trust/Model) + routing (/ /explorer /business)
        ├── pages/Explorer.tsx      /explorer — n8n workflow tree + one-click live run (SSE -> :4030);
        │                           2 real settled reference jobs + the live job. SERVER const = :4030
        ├── pages/Business.tsx      /business — full business model (revenue/verifier economics/demand/risks)
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

## 8. DONE: one-click "Run a live job"

Built and verified on Fuji. `agents/src/server.ts` (express, :4030) exposes
`GET /api/run?mode=honest|fail` and streams step events over SSE; `agents/src/live.ts` runs one real
job (create/fund/accept/submit/verify/verdict/finalize/outcome). The Explorer run-bar opens the SSE
stream and lights up nodes live with real tx hashes. Both gateways use the funded PROVIDER key, and
`live.ts` tops the provider's USDC up from the buyer if a prior FAIL slashed its bond — so repeated
runs (honest or scammer) never drain. `running` flag enforces one job at a time; CORS `*`.

## 9. Next task: host the live-run backend ("put up the agents")

The one-click run only works when `npm run server` is running locally on :4030, because
`web/src/pages/Explorer.tsx` has `const SERVER = "http://localhost:4030"` hardcoded. To make it work
from the deployed site for any judge:
1. Deploy `agents/` (`npm run server`) to a public host (Railway / Render / Fly / small VM) with the
   funded demo `.env`. It needs outbound Fuji RPC + the demo private keys; keep amounts tiny.
2. Replace the hardcoded `SERVER` with an env var, e.g. `const SERVER = import.meta.env.VITE_LIVE_RUN_URL
   ?? "http://localhost:4030"`, and set `VITE_LIVE_RUN_URL` in the site's build env.
3. (Optional hardening) rate-limit `/api/run` by IP and add a simple per-window cap so the demo
   accounts can't be griefed.

---

## 10. DONE: "judge as buyer" full real wallet flow (`/post`)

Built and on `staked-committee`. The judge IS the buyer: their wallet, their real USDC, refunded to
their wallet when a scammer is caught. Files:
- `web/src/wallet.ts` — viem injected wallet (`custom(window.ethereum)`), enforces Fuji 43113
  (switch/add chain), balances, `createJob`, EIP-3009 `signPayment`, `withdraw`.
- `web/src/pages/Post.tsx` (route `/post`) — connect → faucet-drip → pick honest/scammer → judge
  sends `createJob` (pop #1) → signs the EIP-3009 USDC payment (pop #2) → backend runs it, streamed
  into the SAME workflow tree → on FAIL a banner offers **Withdraw** (pop #3) → USDC returns to wallet.
- `web/src/live-job.ts` — shared `LiveStep`/`applyStep`/`readSSE` (Explorer refactored onto it).
- `agents/src/judge.ts` + `POST /api/judge-run`, `/api/config`, `/api/faucet` in `server.ts`. The
  backend only redeems the judge's signed authorization + runs provider/verify/finalize; it never
  withdraws (the judge does, to their own wallet). Faucet drips AVAX+USDC from DEPLOYER/BUYER.

## 11. DONE: real AI provider agents (Groq/Claude)

`agents/src/shared/ai.ts` `work(mode)` makes the providers genuine LLM agents instead of canned dicts.
Honest agent gets the task clues → answers correctly; adversarial agent is denied them → confident,
well-formed-WRONG output. Engine picked by env: `GROQ_API_KEY` (free Llama 3.3 70B) → `ANTHROPIC_API_KEY`
(Claude Haiku) → deterministic fallback (demo never breaks). `engineName()` + the live deliverable are
surfaced in the UI: an "AI engine" badge on `/explorer` + `/post`, and the agent's real answers on the
Submit node. Both the one-click demo and the judge flow run through `work()`. **User has GROQ set →
real AI is live** (verified: scammer returns varying wrong animals each run, proving it's not scripted).

## 12. DONE this session: finalize race fix + demo legibility

- **Finalize race fix** (`agents/src/buyer.ts` `finalizeWithRetry`): a fixed off-chain sleep could
  finish while the on-chain challenge window was still open → revert `ChallengeWindowOpen()` (selector
  `0xfa7bc547`). Now detects that revert and waits it out; used by both live + judge flows; buffer bumped
  to window+8s. Verified end-to-end (scammer job #18 settled).
- **Demo legibility:** `/explorer` shows a JOB card (the task + 3 clues from `/api/config` + the
  committed answer key + honest-vs-scammer outcomes). New **`/docs`** page (problem → 7-step loop →
  components → 3 correctness tiers → real-world walkthrough → today-vs-scale). Nav: Docs, Live Demo,
  Business, Post a job.
- **Style:** em dashes removed across all pages (read less templated) — periods/commas instead.

## 13. Still next

1. **Host `agents/src/server.ts` publicly** (the one remaining build) + set `VITE_LIVE_RUN_URL` so both
   interactive flows work from the deployed site. `.env` on the host needs GROQ_API_KEY + demo keys.
2. **Browser smoke-test of `/post`** end-to-end against Fuji (3 wallet pops). Verified to typecheck/build
   + a curl `/api/run`, but not yet driven with a real injected wallet.
3. Recording; merge `staked-committee` → `main`; optional agent-SDK page; docs/threat-model pass.

**Local run for both flows:** `cd agents && npm run server` (:4030, needs `$HOME/.cargo/bin` on PATH);
`cd web && npm run dev` (:5173). Server is one-job-at-a-time; restart it after changing `.env`.
