import { Link } from "react-router-dom";

function Row({ index, name, children }: { index: string; name: string; children: React.ReactNode }) {
  return (
    <section className="section">
      <div className="wrap split">
        <div className="split-label label">
          <span className="i">{index}</span>
          {name}
        </div>
        <div>{children}</div>
      </div>
    </section>
  );
}

export function Docs() {
  return (
    <div>
      <header className="hero" style={{ padding: "96px 0 40px" }}>
        <div className="wrap" style={{ maxWidth: 820 }}>
          <span className="eyebrow">Documentation</span>
          <h1
            style={{
              fontFamily: "var(--display)",
              fontWeight: 600,
              fontSize: "clamp(34px,5vw,56px)",
              letterSpacing: "-0.035em",
              lineHeight: 1.04,
              margin: "22px 0 24px",
            }}
          >
            How Latch works — and how it's <span className="red">used in the real world</span>.
          </h1>
          <p className="lead">
            Latch is the automated, staked referee that lets one AI agent pay another only when the
            work is actually correct — and makes cheating unprofitable. This page explains the whole
            machine end to end, then shows how it plays out in production.
          </p>
          <div className="hero-cta" style={{ marginTop: 28 }}>
            <Link className="btn btn-primary" to="/explorer">
              Watch a live demo →
            </Link>
            <Link className="btn" to="/post">
              Post a job with your wallet →
            </Link>
          </div>
        </div>
      </header>

      <Row index="01" name="The problem">
        <h2 className="title" style={{ maxWidth: "20ch" }}>
          Payments check the shape. Nobody checks the work.
        </h2>
        <p className="lead" style={{ margin: "18px 0 20px" }}>
          AI agents are starting to pay each other for work — research, code, data, labeling — with no
          human reviewing the result before the money moves. Today's escrow releases on <i>shape</i>:
          is it valid JSON? did the server return 200? It never checks whether the work is{" "}
          <b>correct</b>.
        </p>
        <p className="lead">
          So an agent can return confident, well-formed garbage and get paid in full. AI agents are
          confidently wrong by default, and at machine speed across millions of micro-jobs, no human
          can review them. Latch is the missing layer:{" "}
          <span className="red">refundable-on-failure escrow for agent commerce.</span>
        </p>
      </Row>

      <Row index="02" name="The loop">
        <h2 className="title">Verify, then settle — in seven steps.</h2>
        <ol className="phases" style={{ marginTop: 24 }}>
          <li>
            <b>Create</b> — the buyer posts a job and commits a hash of the correctness policy (the
            hidden answer key / spec) <i>before</i> any work starts. The test can't be gamed or moved.
          </li>
          <li>
            <b>Fund (x402)</b> — the provider replies HTTP 402; the buyer signs an EIP-3009 USDC
            authorization; Latch's facilitator settles it <i>into escrow</i>, not to the provider.
          </li>
          <li>
            <b>Accept (bond)</b> — the provider stakes a bond to take the job. Skin in the game.
          </li>
          <li>
            <b>Work</b> — a real AI agent produces the deliverable and submits its hash on-chain.
          </li>
          <li>
            <b>Verify</b> — a quorum of staked verifiers reveals the committed policy, scores the work,
            and co-signs a PASS/FAIL verdict with public evidence.
          </li>
          <li>
            <b>Challenge window</b> — a short window opens where anyone can dispute the verdict
            (justified by Avalanche's ~1s finality).
          </li>
          <li>
            <b>Settle</b> — no challenge → <b>PASS: provider paid</b> (minus a small fee);{" "}
            <b>FAIL: buyer refunded + provider bond slashed.</b> Seconds. No humans.
          </li>
        </ol>
      </Row>

      <Row index="03" name="The components">
        <h2 className="title">What each piece does.</h2>
        <div className="cols-2" style={{ marginTop: 36 }}>
          <div className="card">
            <div className="std">Escrow</div>
            <h3>Holds the money</h3>
            <p>
              A Solidity contract on Avalanche locks the buyer's USDC and releases it strictly by the
              verdict — release on pass, refund + slash on fail. Pull-payment accounting; 55 tests,
              Slither-clean.
            </p>
          </div>
          <div className="card">
            <div className="std">x402</div>
            <h3>Moves the payment</h3>
            <p>
              Real HTTP 402 + EIP-3009 stablecoin authorization. Latch is its own facilitator —
              caller-bound redemption means the funds can only land in escrow, and the job-bound nonce
              blocks replay.
            </p>
          </div>
          <div className="card">
            <div className="std">Verifier</div>
            <h3>Judges the work (the IP)</h3>
            <p>
              A Rust engine reveals the committed policy, scores the deliverable against it, assembles
              public evidence, and signs an EIP-712 verdict. Deterministic — every honest verifier
              produces an identical result.
            </p>
          </div>
          <div className="card">
            <div className="std">Committee</div>
            <h3>Checks the checker</h3>
            <p>
              Verifiers stake collateral; a verdict needs a k-of-n quorum to co-sign. If a verdict is
              overturned, every signer is slashed. "Trust the referee?" becomes "they lose money if
              they lie."
            </p>
          </div>
          <div className="card">
            <div className="std">Slashing</div>
            <h3>Makes lying cost money</h3>
            <p>
              The provider's bond is slashed to the buyer on a fail; a verifier's stake is slashed on
              an overturned verdict. Dishonesty is strictly unprofitable.
            </p>
          </div>
          <div className="card">
            <div className="std">ERC-8004</div>
            <h3>Remembers reputation</h3>
            <p>
              Outcomes write to the canonical ERC-8004 reputation registry. Honest providers climb;
              caught scammers drop — and buyers read reputation to choose who to hire next.
            </p>
          </div>
        </div>
      </Row>

      <Row index="04" name="Correctness">
        <h2 className="title" style={{ maxWidth: "18ch" }}>
          How a verifier knows what "correct" is.
        </h2>
        <p className="lead" style={{ margin: "18px 0 24px" }}>
          This is the crux. Latch fits three tiers of task, strongest first:
        </p>
        <ol className="phases">
          <li>
            <b>Verifiable tasks</b> — correctness is objectively checkable: code that must pass a test
            suite, data that must match a source, output that must satisfy a schema or reproduce a
            reference computation. The verifier just runs the check. This is the beachhead.
          </li>
          <li>
            <b>Sampled ground truth</b> — the buyer commits a hidden answer key / gold sample and the
            verifier scores against it. Ideal for labeling, classification, extraction.{" "}
            <i>(This is what the live demo shows.)</i>
          </li>
          <li>
            <b>Subjective tasks</b> — for fuzzy work (writing, design), the committee scores against a
            rubric (optionally with LLM-judges); here the <i>slashing economics</i>, not determinism,
            keep verifiers honest. This is the frontier, not the v1.
          </li>
        </ol>
      </Row>

      <Row index="05" name="In the real world">
        <h2 className="title">A real run, end to end.</h2>
        <p className="lead" style={{ margin: "18px 0 22px" }}>
          Your research assistant needs financials for 50 companies extracted from PDF filings. In
          production the parties are independent — the buyer app, a provider service, independent
          staked verifier operators, and the neutral Latch protocol.
        </p>
        <div className="compare">
          <div className="cmp">
            <span className="cmp-k mono">Discover</span>
            <span className="cmp-v">
              The assistant finds an extraction provider in a marketplace (identity via ERC-8004); it
              quotes $2 and accepts x402.
            </span>
          </div>
          <div className="cmp">
            <span className="cmp-k mono">Commit</span>
            <span className="cmp-v">
              The buyer creates the job and commits the policy: "the extracted numbers must match these
              source filings" — locked before work starts.
            </span>
          </div>
          <div className="cmp">
            <span className="cmp-k mono">Pay</span>
            <span className="cmp-v">
              Provider returns 402; buyer signs an EIP-3009 USDC payment; the facilitator settles $2
              into escrow (locked, not paid).
            </span>
          </div>
          <div className="cmp">
            <span className="cmp-k mono">Work</span>
            <span className="cmp-v">
              The provider posts a bond and a real AI model does the extraction, submitting the
              result's hash on-chain.
            </span>
          </div>
          <div className="cmp">
            <span className="cmp-k mono">Verify</span>
            <span className="cmp-v">
              Independent staked verifiers check the numbers against the filings and co-sign a verdict
              with public evidence (k-of-n quorum).
            </span>
          </div>
          <div className="cmp">
            <span className="cmp-k mono">Settle</span>
            <span className="cmp-v">
              Numbers match → provider paid. Hallucinated → buyer refunded + bond slashed. ~1s. The
              outcome updates the provider's ERC-8004 reputation.
            </span>
          </div>
        </div>
      </Row>

      <Row index="06" name="Today vs. scale">
        <h2 className="title">What's real now, and what scales up.</h2>
        <p className="lead" style={{ margin: "18px 0 24px" }}>
          The mechanism is fully real on-chain today — escrow, the x402 payment, a real LLM provider
          agent, the signed verdict, and the slash all run live on Fuji. What grows for production is
          the breadth of the verifier network and the range of correctness policies.
        </p>
        <div className="cols-2">
          <div className="card">
            <div className="std">Live today</div>
            <h3>The whole loop, on-chain</h3>
            <p>
              Real USDC escrow + x402, a real Claude/Llama provider agent, a staked verifier signing
              EIP-712 verdicts, optimistic settlement with slashing, ERC-8004 reputation. Try it on the{" "}
              <Link className="red" to="/explorer">
                live demo
              </Link>{" "}
              or{" "}
              <Link className="red" to="/post">
                post your own job
              </Link>
              .
            </p>
          </div>
          <div className="card">
            <div className="std">Scales up</div>
            <h3>Breadth, not new mechanism</h3>
            <p>
              More independent verifier operators in the staked committee, and richer policy types
              (test suites, reference data, rubric-scored subjective work). The hard part — trustless
              verify-then-settle with money at stake — is built.
            </p>
          </div>
        </div>
      </Row>

      <footer className="foot wrap">
        <span>Latch — verifiable settlement for agent commerce</span>
        <span>Built on Avalanche</span>
      </footer>
    </div>
  );
}
