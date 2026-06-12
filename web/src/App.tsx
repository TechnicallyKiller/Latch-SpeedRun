import { BrowserRouter, Link, Route, Routes } from "react-router-dom";
import { Explorer } from "./pages/Explorer";

const LATCH = "0xa5cA9c7920F22E1104215C430227756dEBBb2a09";
const SNOWTRACE = `https://testnet.snowtrace.io/address/${LATCH}`;

function Nav() {
  return (
    <nav className="nav">
      <div className="wrap nav-inner">
        <Link to="/" className="brand">
          <span className="mark" />
          Latch
        </Link>
        <div className="nav-links">
          <a href="/#loop">How it works</a>
          <Link to="/explorer">Explorer</Link>
          <a href="/#model">Business</a>
          <a className="pill" href={SNOWTRACE} target="_blank" rel="noreferrer">
            <span className="live" />
            Live on Fuji
          </a>
          <Link to="/explorer" className="btn btn-primary nav-run">
            Run a live job
          </Link>
        </div>
      </div>
    </nav>
  );
}

function Receipt({
  title,
  tag,
  tagKind,
  rows,
  note,
}: {
  title: string;
  tag: string;
  tagKind: "pass" | "fail";
  rows: [string, string, boolean?][];
  note?: string;
}) {
  return (
    <div className="receipt">
      <div className="receipt-head">
        <span>{title}</span>
        <span className={`tag tag-${tagKind}`}>{tag}</span>
      </div>
      <div className="receipt-body">
        {rows.map(([k, v, red]) => (
          <div className="r-row" key={k}>
            <span>{k}</span>
            <b className={red ? "red" : ""}>{v}</b>
          </div>
        ))}
        {note && (
          <p style={{ marginTop: 14, color: "var(--text-faint)", fontSize: 12, lineHeight: 1.6 }}>{note}</p>
        )}
      </div>
    </div>
  );
}

function Hero() {
  return (
    <header className="hero">
      <div className="wrap hero-grid">
        <div>
          <span className="eyebrow">Verifiable settlement · Avalanche</span>
          <h1>
            Escrow that releases only when the work is <span className="red">verifiably correct</span>.
          </h1>
          <p className="lead">
            When one agent pays another, today’s escrow releases on shape — valid JSON, no 5xx. A
            provider that returns well-formed garbage still gets paid. Latch settles against a real,
            evidence-backed correctness verdict from a staked verifier set.
          </p>
          <div className="hero-cta">
            <Link className="btn btn-primary" to="/explorer">
              Run a live job →
            </Link>
            <a className="btn" href="#loop">
              How it works
            </a>
            <a className="btn" href={SNOWTRACE} target="_blank" rel="noreferrer">
              View the contract ↗
            </a>
          </div>
        </div>
        <Receipt
          title="job #2 · ground-truth policy"
          tag="Fail"
          tagKind="fail"
          rows={[
            ["deliverable", "well-formed, wrong"],
            ["score", "0 / 100", true],
            ["verifiers", "staked quorum"],
            ["outcome", "buyer refunded"],
            ["provider bond", "slashed", true],
            ["evidence", "ipfs://QmYVMHj6…"],
          ]}
        />
      </div>

      <div className="wrap">
        <div className="stats">
          <div className="stat">
            <div className="k">~1s</div>
            <div className="l">Avalanche finality</div>
          </div>
          <div className="stat">
            <div className="k">k-of-n</div>
            <div className="l">staked quorum</div>
          </div>
          <div className="stat">
            <div className="k">100%</div>
            <div className="l">on-chain, evidenced</div>
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

function SectionLabel({ index, name }: { index: string; name: string }) {
  return (
    <div className="split-label label">
      <span className="i">{index}</span>
      {name}
    </div>
  );
}

function Gap() {
  return (
    <section className="section">
      <div className="wrap split">
        <SectionLabel index="01" name="The gap" />
        <div>
          <h2 className="title" style={{ maxWidth: "18ch" }}>
            Everyone moves the money. Nobody checks the work.
          </h2>
          <div className="cols-3" style={{ margin: "40px 0" }}>
            <div className="card">
              <div className="std">x402</div>
              <h3>Agents can pay</h3>
              <p>Stablecoin payments over HTTP 402, settled with EIP-3009.</p>
            </div>
            <div className="card">
              <div className="std">ERC-8004</div>
              <h3>Agents can be trusted</h3>
              <p>Identity, reputation and validation registries for agents.</p>
            </div>
            <div className="card">
              <div className="std">ERC-8183</div>
              <h3>Jobs can be escrowed</h3>
              <p>A job, escrow and evaluation shape for agent commerce.</p>
            </div>
          </div>
          <p className="lead" style={{ fontSize: 19, color: "var(--text)" }}>
            None of them answer the only question that matters at settlement:{" "}
            <span className="red">was the deliverable correct?</span> Latch does.
          </p>
        </div>
      </div>
    </section>
  );
}

function Loop() {
  const steps: [string, string, string][] = [
    ["01", "Fund", "Buyer funds USDC escrow with a signed EIP-3009 authorization, bound to the job."],
    ["02", "Work", "Provider posts a bond and submits the deliverable."],
    ["03", "Verify", "A quorum of staked verifiers scores it against a committed answer key."],
    ["04", "Verdict", "They co-sign PASS/FAIL with public evidence; a short challenge window opens."],
    ["05", "Settle", "No challenge → release on pass, refund + slash on fail. Seconds."],
  ];
  return (
    <section className="section" id="loop">
      <div className="wrap split">
        <SectionLabel index="02" name="The loop" />
        <div>
          <h2 className="title">Verify, then settle.</h2>
          <p className="lead" style={{ margin: "16px 0 36px" }}>
            A short challenge window — justified by Avalanche’s ~1s finality — backs an optimistic
            release, with bonds and a dispute path bounding the trust.
          </p>
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
      </div>
    </section>
  );
}

function Trust() {
  return (
    <section className="section" id="trust">
      <div className="wrap split">
        <SectionLabel index="03" name="Trust" />
        <div>
          <h2 className="title" style={{ maxWidth: "16ch" }}>
            Who checks the checker?
          </h2>
          <div
            style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: 40, marginTop: 28, alignItems: "start" }}
            className="trust-grid"
          >
            <div>
              <p className="lead">
                Verifiers stake collateral to judge. A verdict isn’t valid until a quorum of them
                independently agree and co-sign it — and if it’s overturned, every signer is slashed.
                Stake locks while a verdict is pending, so they can’t sign and run.
              </p>
              <p className="lead" style={{ marginTop: 18 }}>
                Because the checks are deterministic, honest verifiers always agree — so a
                disagreement is itself provable evidence of fault, replayable from the public record.
                “Trust the referee?” becomes “they lose money if they lie.”
              </p>
            </div>
            <Receipt
              title="overturned verdict"
              tag="Slashed"
              tagKind="fail"
              rows={[
                ["verifier A", "− stake", true],
                ["verifier B", "− stake", true],
                ["verifier C", "− stake", true],
                ["paid to", "wronged party"],
              ]}
            />
          </div>
        </div>
      </div>
    </section>
  );
}

function Model() {
  return (
    <section className="section" id="model">
      <div className="wrap split">
        <SectionLabel index="04" name="Business" />
        <div>
          <h2 className="title" style={{ maxWidth: "20ch" }}>
            A take-rate on every transaction we make safe.
          </h2>
          <div className="cols-3" style={{ marginTop: 40 }}>
            <div className="card">
              <div className="std">01 · SaaS</div>
              <h3>Hosted verification</h3>
              <p>“You run agents, we run the referee.” Per-verification pricing and custom policies. The nearest revenue.</p>
            </div>
            <div className="card">
              <div className="std">02 · Protocol</div>
              <h3>Take-rate on volume</h3>
              <p>A small fee on every settled job, compounding as autonomous agent commerce scales.</p>
            </div>
            <div className="card">
              <div className="std">03 · Network</div>
              <h3>Staked verifier set</h3>
              <p>Oracle-network economics: verifiers earn fees, stake yields, reputation compounds.</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="foot wrap">
      <span>Latch — verifiable settlement for agent commerce</span>
      <span>Built on Avalanche</span>
    </footer>
  );
}

function Landing() {
  return (
    <>
      <Hero />
      <Gap />
      <Loop />
      <Trust />
      <Model />
      <Footer />
    </>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Nav />
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/explorer" element={<Explorer />} />
      </Routes>
    </BrowserRouter>
  );
}
