import { SiteFooter } from "../components/SiteFooter";

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

export function Business() {
  return (
    <div>
      <header className="hero" style={{ padding: "96px 0 40px" }}>
        <div className="wrap" style={{ maxWidth: 820 }}>
          <span className="eyebrow">Business model</span>
          <h1 style={{ fontFamily: "var(--display)", fontWeight: 600, fontSize: "clamp(34px,5vw,56px)", letterSpacing: "-0.035em", lineHeight: 1.04, margin: "22px 0 24px" }}>
            We take a small cut of every transaction we make <span className="red">safe</span>.
          </h1>
          <p className="lead">
            Latch is the trust-and-settlement rail for the agent economy. The money is in
            throughput, not margin: the take-rate stays low because agent payments are small and
            price-sensitive, so the value is in the total volume of agent commerce settled, and
            verified, through Latch.
          </p>
        </div>
      </header>

      <Row index="01" name="Revenue">
        <h2 className="title">Three lines, nearest cash first.</h2>
        <div className="cols-3" style={{ marginTop: 36 }}>
          <div className="card">
            <div className="std">SaaS</div>
            <h3>Hosted verification</h3>
            <p>
              The verifier is the IP. “You run agents, we run the referee.” Per-verification pricing
              or a subscription, plus custom policy authoring for enterprises. Earns money before a
              large agent economy exists, teams running agent fleets need this today.
            </p>
          </div>
          <div className="card">
            <div className="std">Protocol</div>
            <h3>Take-rate on volume</h3>
            <p>
              A small protocol fee on every successful settlement (the on-chain fee primitive
              already exists). Small per job, compounding as autonomous agent commerce scales.
            </p>
          </div>
          <div className="card">
            <div className="std">Network</div>
            <h3>Staked verifier set</h3>
            <p>
              Oracle-network economics. The staked committee is itself a business: verifiers earn
              fees and stake yield; Latch takes a cut and runs the founding operators. Long-term
              value capture with network effects.
            </p>
          </div>
        </div>
      </Row>

      <Row index="02" name="Verifier economics">
        <h2 className="title" style={{ maxWidth: "18ch" }}>
          How the referees earn.
        </h2>
        <p className="lead" style={{ margin: "18px 0 24px" }}>
          A portion of each settled job's protocol fee is paid to the quorum that signed the verdict,
          split by participation. A verifier's economics are:
        </p>
        <div className="formula mono">
          verification fees <span className="red">+</span> stake yield
          <span className="red"> − </span> operating cost <span className="red"> − </span> slashing risk
        </div>
        <p className="lead" style={{ marginTop: 20 }}>
          Honest, competent operators profit; lazy or dishonest ones are slashed and exit. Because
          verification is deterministic, slashing is objective, disagreement with the public
          evidence is provable, not a vote.{" "}
          <span style={{ color: "var(--text-faint)" }}>
            (Status: the fee primitive and staking/slashing are built; the fee-to-verifier split is
            the designed incentive, not yet coded, today the fee accrues to the protocol.)
          </span>
        </p>
      </Row>

      <Row index="03" name="Demand">
        <h2 className="title">Who pays, and why it's rational.</h2>
        <div className="cols-2" style={{ marginTop: 36 }}>
          <div className="card">
            <h3>Buyers</h3>
            <p>
              The fee is cheap insurance against paying full price for garbage, trivially worth it
              versus the downside of an unverified deliverable.
            </p>
          </div>
          <div className="card">
            <h3>Honest providers</h3>
            <p>
              Verifiable correctness lets them beat cheaper scammers. It creates a market that
              rewards quality, which low-quality competitors can't game.
            </p>
          </div>
        </div>
        <div className="compare">
          <div className="cmp"><span className="cmp-k mono">Stripe</span><span className="cmp-v">payment rail, ~2.9%/tx, moves money, doesn't verify substance</span></div>
          <div className="cmp"><span className="cmp-k mono">Upwork / Escrow.com</span><span className="cmp-v">human escrow + dispute, 5–20%. Latch automates the “was it correct?” judgment, no human</span></div>
          <div className="cmp"><span className="cmp-k mono">Chainlink</span><span className="cmp-v">oracle network. Latch is an oracle for correctness, not price</span></div>
        </div>
      </Row>

      <Row index="04" name="Path">
        <h2 className="title">Phasing, and the honest risks.</h2>
        <ol className="phases">
          <li><b>Grants</b> fund the build and prove the loop on-chain.</li>
          <li><b>Hosted verification (SaaS)</b> for early cash and IP validation.</li>
          <li><b>Protocol take-rate</b> as agent volume grows.</li>
          <li><b>Open the staked verifier network</b> as the trust rail for the broader agent economy.</li>
        </ol>
        <p className="lead" style={{ marginTop: 26, color: "var(--text-dim)" }}>
          Risk, stated plainly: agent-to-agent commerce at scale is forming, not formed (x402 /
          ERC-8004 / ERC-8183 are early), so the take-rate play is a bet on that market emerging.
          The SaaS line funds the company while it matures. A token is optional and not assumed; the
          fee + SaaS model stands without one.
        </p>
      </Row>

      <SiteFooter />
    </div>
  );
}
