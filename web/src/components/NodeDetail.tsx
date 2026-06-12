import { snowtraceTx } from "../chain";
import type { Step } from "../lifecycle";

const LANG: Record<string, string> = { sol: "Solidity", rust: "Rust", ts: "TypeScript" };

export function NodeDetail({ step }: { step: Step }) {
  return (
    <div className="node-detail">
      <div className="nd-head">
        <span className={`nd-actor a-${step.actor}`}>{step.actor}</span>
        <h3>{step.title}</h3>
      </div>
      <p className="nd-summary">{step.summary}</p>
      <p className="nd-detail">{step.detail}</p>

      {step.data && (
        <div className="nd-data">
          {step.data.map(([k, v]) => (
            <div className="nd-row" key={k}>
              <span>{k}</span>
              <b>{v}</b>
            </div>
          ))}
        </div>
      )}

      <div className="nd-code">
        <div className="nd-label">Code path · {step.actor === "verifier" && step.key === "verify" ? "off-chain" : "on-chain"}</div>
        {step.code.map((c) => (
          <div className="nd-coderef" key={c.ref}>
            <span className={`lang lang-${c.lang}`}>{LANG[c.lang]}</span>
            <code>{c.ref}</code>
            <span className="cnote">{c.note}</span>
          </div>
        ))}
      </div>

      {step.tx && (
        <a className="btn nd-tx" href={snowtraceTx(step.tx)} target="_blank" rel="noreferrer">
          View transaction on Snowtrace ↗
        </a>
      )}
    </div>
  );
}
