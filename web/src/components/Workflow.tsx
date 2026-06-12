import type { Actor, Step } from "../lifecycle";

const ACTOR: Record<Actor, string> = {
  buyer: "Buyer",
  provider: "Provider",
  verifier: "Verifier",
  facilitator: "Facilitator",
  contract: "Contract",
};

export function Workflow({
  steps,
  selected,
  onSelect,
}: {
  steps: Step[];
  selected: string;
  onSelect: (key: string) => void;
}) {
  return (
    <div className="flow-graph">
      {steps.map((s, i) => (
        <div className="flow-cell" key={s.key}>
          <button
            className={`flow-node st-${s.status}${s.key === selected ? " sel" : ""}`}
            onClick={() => onSelect(s.key)}
          >
            <span className="fn-actor">{ACTOR[s.actor]}</span>
            <span className="fn-title">{s.title}</span>
            <span className="fn-foot">
              <span className={`fn-dot d-${s.status}`} />
              <span className="fn-tag">{s.tx ? "on-chain" : s.actor === "verifier" && s.key === "verify" ? "off-chain · rust" : s.status === "context" ? "context" : "—"}</span>
            </span>
          </button>
          {i < steps.length - 1 && <span className="flow-arrow" aria-hidden />}
        </div>
      ))}
    </div>
  );
}
