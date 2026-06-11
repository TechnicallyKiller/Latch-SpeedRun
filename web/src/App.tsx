const LATCH = "0xa5cA9c7920F22E1104215C430227756dEBBb2a09";
const SNOWTRACE = `https://testnet.snowtrace.io/address/${LATCH}`;

function Nav() {
  return (
    <nav className="nav">
      <div className="wrap nav-inner">
        <div className="brand">
          <span className="dot" />
          LATCH
        </div>
        <div className="nav-links">
          <a href="#how">How it works</a>
          <a href="#trust">Trust</a>
          <a href="#business">Business</a>
          <a className="pill" href={SNOWTRACE} target="_blank" rel="noreferrer">
            <span className="live" />
            Live on Fuji
          </a>
        </div>
      </div>
    </nav>
  );
}

function Hero() {
  return (
    <header className="hero">
      <div className="wrap hero-grid">
        <div>
          <span className="eyebrow">Verifiable settlement · Avalanche</span>
          <h1>
            Escrow that knows if the work is <em>actually correct</em>
          </h1>
          <p className="lead">
            When one agent pays another, existing escrow releases funds on shape — valid JSON, no
            5xx. A provider that returns well-formed garbage gets paid. Latch releases only against a
            real, evidence-backed correctness verdict from a staked verifier set.
          </p>
          <div className="hero-cta">
            <a className="btn btn-primary" href="#how">
              See how it works →
            </a>
            <a className="btn" href={SNOWTRACE} target="_blank" rel="noreferrer">
              View contract
            </a>
          </div>
        </div>

        <div className="card card-red verdict-card">
          <div className="verdict-head">
            <span style={{ color: "var(--text-faint)" }}>job #2 · ground-truth policy</span>
            <span className="tag tag-fail">Fail</span>
          </div>
          <div className="verdict-row">
            <span>deliverable</span>
            <b>well-formed, wrong</b>
          </div>
          <div className="verdict-row">
            <span>score</span>
            <b className="red">0 / 100</b>
          </div>
          <div className="verdict-row">
            <span>quorum</span>
            <b>staked verifiers</b>
          </div>
          <div className="verdict-row">
            <span>outcome</span>
            <b>buyer refunded</b>
          </div>
          <div className="verdict-row">
            <span>provider bond</span>
            <b className="red">slashed</b>
          </div>
          <div
            className="verdict-row"
            style={{ borderTop: "1px solid var(--line)", marginTop: 8, paddingTop: 14 }}
          >
            <span>evidence</span>
            <b>ipfs://QmYVMHj6…</b>
          </div>
        </div>
      </div>

      <div className="wrap">
        <div className="stats">
          <div className="stat">
            <div className="k">~1s</div>
            <div className="l">Avalanche finality</div>
          </div>
          <div className="stat">
            <div className="k">k-of-n</div>
            <div className="l">staked verifier quorum</div>
          </div>
          <div className="stat">
            <div className="k">100%</div>
            <div className="l">on-chain &amp; evidenced</div>
          </div>
          <div className="stat">
            <div className="k">0</div>
            <div className="l">humans in the loop</div>
          </div>
        </div>
      </div>
    </header>
  );
}

function Problem() {
  return (
    <section className="section">
      <div className="wrap">
        <span className="eyebrow">The gap</span>
        <h2 className="title" style={{ marginTop: 18, maxWidth: "16ch" }}>
          Everyone moves the money. Nobody checks the work.
        </h2>
        <div className="cols-3">
          <div className="card">
            <div className="std">x402</div>
            <h3>Agents can pay</h3>
            <p>Stablecoin payments over HTTP 402, settled with EIP-3009. Answers “can they pay?”</p>
          </div>
          <div className="card">
            <div className="std">ERC-8004</div>
            <h3>Agents can be trusted</h3>
            <p>Identity, reputation and validation registries. Answers “who to trust?”</p>
          </div>
          <div className="card">
            <div className="std">ERC-8183</div>
            <h3>Jobs can be escrowed</h3>
            <p>A job/escrow/evaluation shape for agent commerce. Answers “how to structure it?”</p>
          </div>
        </div>
        <p className="lead" style={{ marginTop: 34, fontSize: 20, color: "var(--text)" }}>
          None of them answer the only question that matters at settlement:{" "}
          <span className="red">was the deliverable correct?</span> Latch does.
        </p>
      </div>
    </section>
  );
}

function How() {
  const steps: [string, string, string][] = [
    ["01", "Fund", "Buyer funds USDC escrow with a signed EIP-3009 authorization, bound to the job."],
    ["02", "Work", "Provider posts a bond and submits the deliverable. Bond = skin in the game."],
    ["03", "Verify", "A quorum of staked verifiers scores it against a committed answer key, off-chain & deterministic."],
    ["04", "Verdict", "They co-sign a PASS/FAIL with public evidence; the contract opens a short challenge window."],
    ["05", "Settle", "No challenge → release on pass, refund + slash on fail. Seconds, thanks to fast finality."],
  ];
  return (
    <section className="section" id="how">
      <div className="wrap">
        <span className="eyebrow">The loop</span>
        <h2 className="title" style={{ marginTop: 18 }}>
          Verify, then settle.
        </h2>
        <div className="flow">
          {steps.map(([n, h, p]) => (
            <div className="step" key={n}>
              <span className="n">{n}</span>
              <h4>{h}</h4>
              <p>{p}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Trust() {
  return (
    <section className="section" id="trust">
      <div className="wrap hero-grid" style={{ alignItems: "start" }}>
        <div>
          <span className="eyebrow">The staked committee</span>
          <h2 className="title" style={{ margin: "18px 0 24px" }}>
            Who checks the checker?
          </h2>
          <p className="lead">
            Verifiers must stake collateral to judge. A verdict isn’t valid until a quorum of them
            independently agree and co-sign it — and if a verdict is overturned, every signer is
            slashed. They can’t unstake while a verdict is pending, so they can’t sign and run.
          </p>
          <p className="lead" style={{ marginTop: 18 }}>
            Because the checks are deterministic, honest verifiers always agree — so a disagreement
            is itself provable evidence of fault, replayable from the public evidence.
          </p>
        </div>
        <div className="card card-red verdict-card" style={{ alignSelf: "stretch" }}>
          <div className="verdict-head">
            <span style={{ color: "var(--text-faint)" }}>overturned verdict</span>
            <span className="tag tag-fail">Slashed</span>
          </div>
          <div className="verdict-row">
            <span>verifier A</span>
            <b className="red">−stake</b>
          </div>
          <div className="verdict-row">
            <span>verifier B</span>
            <b className="red">−stake</b>
          </div>
          <div className="verdict-row">
            <span>verifier C</span>
            <b className="red">−stake</b>
          </div>
          <div
            className="verdict-row"
            style={{ borderTop: "1px solid var(--line)", marginTop: 8, paddingTop: 14 }}
          >
            <span>paid to</span>
            <b>wronged party</b>
          </div>
          <p style={{ marginTop: 16, color: "var(--text-faint)", fontSize: 12, lineHeight: 1.6 }}>
            “Trust the referee?” becomes “they lose money if they lie.”
          </p>
        </div>
      </div>
    </section>
  );
}

function BusinessTeaser() {
  return (
    <section className="section" id="business">
      <div className="wrap">
        <span className="eyebrow">Business model</span>
        <h2 className="title" style={{ marginTop: 18, maxWidth: "20ch" }}>
          A take-rate on every transaction we make safe.
        </h2>
        <div className="cols-3">
          <div className="card">
            <div className="std">01 · SaaS</div>
            <h3>Hosted verification</h3>
            <p>“You run agents, we run the referee.” Per-verification pricing and custom policies. Nearest revenue.</p>
          </div>
          <div className="card">
            <div className="std">02 · Protocol</div>
            <h3>Take-rate on volume</h3>
            <p>A small fee on every settled job. Compounds as autonomous agent commerce scales.</p>
          </div>
          <div className="card">
            <div className="std">03 · Network</div>
            <h3>The staked verifier set</h3>
            <p>Oracle-network economics: verifiers earn fees, stake yields, reputation compounds.</p>
          </div>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="foot wrap">
      <span>LATCH · VERIFIABLE SETTLEMENT FOR AGENT COMMERCE</span>
      <span>BUILT ON AVALANCHE</span>
    </footer>
  );
}

export default function App() {
  return (
    <>
      <Nav />
      <Hero />
      <Problem />
      <How />
      <Trust />
      <BusinessTeaser />
      <Footer />
    </>
  );
}
