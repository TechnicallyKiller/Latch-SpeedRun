import { useMemo, useRef, useState } from "react";
import { type Job } from "../chain";
import { buildSteps } from "../lifecycle";
import { Workflow } from "../components/Workflow";
import { NodeDetail } from "../components/NodeDetail";
import { SiteFooter } from "../components/SiteFooter";
import { SERVER } from "./Explorer";
import { applyStep, emptyLive, type LiveStep } from "../live-job";

interface Provider {
  id: string;
  name: string;
  blurb: string;
  capability: string;
  price: string;
  reputation: number; // 0..100, from ERC-8004 in production
  mode: "honest" | "fail";
  tag: { label: string; kind: "trusted" | "risk" };
}

// In production these are discovered from a registry + ERC-8004 reputation. Here, two real agents.
const PROVIDERS: Provider[] = [
  {
    id: "trustlabel",
    name: "TrustLabel AI",
    blurb: "Reads the task carefully and returns correct, verifiable output.",
    capability: "data.label",
    price: "0.005 USDC",
    reputation: 98,
    mode: "honest",
    tag: { label: "trusted", kind: "trusted" },
  },
  {
    id: "budgetbot",
    name: "BudgetBot",
    blurb: "Cheapest bid. Confident, fast — and frequently wrong.",
    capability: "data.label",
    price: "0.004 USDC",
    reputation: 11,
    mode: "fail",
    tag: { label: "high risk", kind: "risk" },
  },
];

export function Marketplace() {
  const [hired, setHired] = useState<Provider | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [running, setRunning] = useState<string | null>(null);
  const [phase, setPhase] = useState<"idle" | "running" | "done" | "error">("idle");
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [selKey, setSelKey] = useState("create");
  const esRef = useRef<EventSource | null>(null);

  const steps = useMemo(() => (job ? buildSteps(job) : []), [job]);
  const step = steps.find((s) => s.key === selKey) ?? steps[0];

  function hire(p: Provider) {
    if (phase === "running") return;
    esRef.current?.close();
    setHired(p);
    setJob(emptyLive(`Hired ${p.name}`));
    setRunning(null);
    setSelKey("create");
    setPhase("running");
    setErrMsg(null);

    const es = new EventSource(`${SERVER}/api/run?mode=${p.mode}`);
    esRef.current = es;
    let finished = false;
    es.addEventListener("step", (e) => {
      const s = JSON.parse((e as MessageEvent).data) as LiveStep;
      if (s.status === "running") setRunning(s.key);
      else {
        setRunning((r) => (r === s.key ? null : r));
        setJob((prev) => (prev ? applyStep(prev, s) : prev));
      }
    });
    es.addEventListener("done", () => {
      finished = true;
      setRunning(null);
      setPhase("done");
      es.close();
    });
    es.addEventListener("error", (e) => {
      const data = (e as MessageEvent).data;
      if (data) {
        setErrMsg(JSON.parse(data).error ?? "run failed");
        setPhase("error");
        finished = true;
        es.close();
      } else if (!finished) {
        setErrMsg("lost connection to the engine (is it running?)");
        setPhase("error");
        es.close();
      }
    });
  }

  const passed = job?.settled?.pass;

  return (
    <div className="explorer wrap">
      <header className="exp-head">
        <div>
          <span className="eyebrow">The agent marketplace</span>
          <h1 className="exp-title">Hire an agent. Get protected either way.</h1>
          <p className="lead">
            An "Upwork for AI agents": providers list their work, and a buyer picks one by{" "}
            <b>on-chain reputation</b>. The twist — even if you hire the cheap, low-rep agent that
            scams you, Latch verifies the result and <b>refunds you, slashing the scammer</b>. Pick one
            and watch.
          </p>
        </div>
      </header>

      <div className="mkt-grid">
        {PROVIDERS.map((p) => (
          <div className={`mkt-card ${hired?.id === p.id ? "sel" : ""}`} key={p.id}>
            <div className="mkt-head">
              <h3>{p.name}</h3>
              <span className={`mkt-tag ${p.tag.kind}`}>{p.tag.label}</span>
            </div>
            <p className="mkt-blurb">{p.blurb}</p>
            <div className="mkt-meta mono">
              <span>{p.capability}</span>
              <span>{p.price}</span>
            </div>
            <div className="rep">
              <div className="rep-label mono">
                <span>reputation (ERC-8004)</span>
                <span>{p.reputation}/100</span>
              </div>
              <div className="rep-bar">
                <div className={`rep-fill ${p.tag.kind}`} style={{ width: `${p.reputation}%` }} />
              </div>
            </div>
            <button className="btn btn-primary" disabled={phase === "running"} onClick={() => hire(p)}>
              {phase === "running" && hired?.id === p.id ? "Running on Fuji…" : "Hire & verify →"}
            </button>
          </div>
        ))}
      </div>

      {(phase === "done" || phase === "error") && (
        <div className="mkt-result">
          {phase === "error" ? (
            <span className="run-status mono err">{errMsg}</span>
          ) : passed ? (
            <span className="run-status mono ok">
              {hired?.name} delivered correct work — verified and paid. ✓
            </span>
          ) : (
            <span className="run-status mono">
              ⚠ {hired?.name} returned well-formed garbage — caught, bond slashed, you were refunded. You
              risked nothing.
            </span>
          )}
        </div>
      )}

      {job && (
        <>
          <div className={`exp-flowwrap ${job.settled?.pass === false ? "is-fail" : "is-pass"}`} style={{ marginTop: 22 }}>
            <Workflow steps={steps} selected={step?.key ?? ""} onSelect={setSelKey} running={running ?? undefined} />
          </div>
          {step && <NodeDetail step={step} />}
        </>
      )}

      <SiteFooter />
    </div>
  );
}
