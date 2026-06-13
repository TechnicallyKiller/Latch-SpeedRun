import { useEffect, useMemo, useRef, useState } from "react";
import { JOBS, LATCH, snowtraceAddr, usdc, type Job } from "../chain";
import { buildSteps } from "../lifecycle";
import { Workflow } from "../components/Workflow";
import { NodeDetail } from "../components/NodeDetail";
import { applyStep, emptyLive as makeLive, type LiveStep } from "../live-job";

export const SERVER = import.meta.env.VITE_LIVE_RUN_URL ?? "http://localhost:4030";

function emptyLive(mode: string): Job {
  return makeLive(`Live run · ${mode === "fail" ? "scammer" : "honest"}`);
}

function WalletCard({
  role,
  desc,
  amount,
  delta,
  accent,
}: {
  role: string;
  desc: string;
  amount: string;
  delta?: bigint;
  accent: "buy" | "prov";
}) {
  const moved = delta !== undefined && delta !== 0n;
  const abs = moved ? (Number(delta > 0n ? delta : -delta) / 1e6).toLocaleString(undefined, { maximumFractionDigits: 6 }) : "";
  return (
    <div className={`wallet-card flash ${accent}`}>
      <div className="wallet-top">
        <span className="wallet-role">{role}</span>
        {moved && (
          <span className={`wallet-delta ${delta! > 0n ? "up" : "down"}`}>
            {delta! > 0n ? "+" : "−"}
            {abs}
          </span>
        )}
      </div>
      <span className="wallet-amt mono">{usdc(BigInt(amount))}</span>
      <span className="wallet-desc">{desc}</span>
    </div>
  );
}

export function Explorer() {
  const [live, setLive] = useState<Job | null>(null);
  const [running, setRunning] = useState<string | null>(null); // currently-running node key
  const [phase, setPhase] = useState<"idle" | "running" | "done" | "error">("idle");
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const esRef = useRef<EventSource | null>(null);

  const [idx, setIdx] = useState(0);
  const [selKey, setSelKey] = useState("create");
  const [engine, setEngine] = useState<string | null>(null);
  const [task, setTask] = useState<Record<string, string> | null>(null);
  const [windowSec, setWindowSec] = useState(30);
  const [balances, setBalances] = useState<{ buyer: string; provider: string } | null>(null);
  const [delta, setDelta] = useState<{ buyer: bigint; provider: bigint } | null>(null);
  const lastBalRef = useRef<{ buyer: string; provider: string } | null>(null);
  const [flash, setFlash] = useState(0); // bumps on each balance update to retrigger the flash anim
  const [countdown, setCountdown] = useState<number | null>(null);

  useEffect(() => {
    fetch(`${SERVER}/api/config`)
      .then((r) => r.json())
      .then((c) => {
        setEngine(c.engine);
        setTask(c.task ?? null);
        if (c.window) setWindowSec(c.window);
      })
      .catch(() => setEngine(null));
  }, []);

  // countdown during the challenge window so the wait reads as intentional, not a hang
  useEffect(() => {
    if (running !== "finalize") {
      setCountdown(null);
      return;
    }
    setCountdown(windowSec);
    const id = setInterval(() => setCountdown((c) => (c === null ? null : Math.max(0, c - 1))), 1000);
    return () => clearInterval(id);
  }, [running, windowSec]);

  const jobs = useMemo(() => (live ? [live, ...JOBS] : JOBS), [live]);
  const job = jobs[Math.min(idx, jobs.length - 1)];
  const steps = useMemo(() => buildSteps(job), [job]);
  const step = steps.find((s) => s.key === selKey) ?? steps[0];
  const isLiveSelected = live !== null && idx === 0;

  function handleStep(s: LiveStep) {
    if (s.balances) {
      const prev = lastBalRef.current;
      if (prev) {
        setDelta({
          buyer: BigInt(s.balances.buyer) - BigInt(prev.buyer),
          provider: BigInt(s.balances.provider) - BigInt(prev.provider),
        });
      }
      lastBalRef.current = s.balances;
      setBalances(s.balances);
      setFlash((f) => f + 1);
    }
    if (s.status === "running") setRunning(s.key);
    else {
      setRunning((r) => (r === s.key ? null : r));
      setLive((prev) => (prev ? applyStep(prev, s) : prev));
    }
  }

  function bindStream(es: EventSource, opts?: { onStart?: (mode: string) => void }) {
    let finished = false;
    es.addEventListener("start", (e) => {
      const mode = JSON.parse((e as MessageEvent).data).mode === "fail" ? "fail" : "honest";
      opts?.onStart?.(mode);
    });
    es.addEventListener("step", (e) => handleStep(JSON.parse((e as MessageEvent).data) as LiveStep));
    es.addEventListener("done", () => {
      finished = true;
      setRunning(null);
      setPhase("done");
      es.close();
    });
    es.addEventListener("idle", () => es.close()); // attach: nothing running
    es.addEventListener("error", (e) => {
      const data = (e as MessageEvent).data;
      if (data) {
        setErrMsg(JSON.parse(data).error ?? "run failed");
        setPhase("error");
        finished = true;
        es.close();
      } else if (!finished) {
        setErrMsg("lost connection to the engine (is it running on :4030?)");
        setPhase("error");
        es.close();
      }
    });
  }

  // On mount, reattach to any run still in progress (e.g. after navigating away mid-run).
  useEffect(() => {
    const es = new EventSource(`${SERVER}/api/run/attach`);
    bindStream(es, {
      onStart: (mode) => {
        setLive((prev) => prev ?? emptyLive(mode));
        setIdx(0);
        setPhase("running");
        setRunning(null);
        lastBalRef.current = null;
        setBalances(null);
        setDelta(null);
      },
    });
    return () => es.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function run(mode: "honest" | "fail") {
    if (phase === "running") return;
    esRef.current?.close();
    setLive(emptyLive(mode));
    setIdx(0);
    setSelKey("create");
    setPhase("running");
    setErrMsg(null);
    setRunning(null);
    setBalances(null);
    setDelta(null);
    lastBalRef.current = null;

    const es = new EventSource(`${SERVER}/api/run?mode=${mode}`);
    esRef.current = es;
    bindStream(es);
  }

  return (
    <div className="explorer wrap">
      <header className="exp-head">
        <div>
          <span className="eyebrow">Live demo</span>
          <h1 className="exp-title">Watch a real job settle, step by step.</h1>
          <p className="lead">
            Press a button below and Latch runs a <b>real job on Fuji</b>, no wallet needed. Each
            node lights up as it lands on-chain; click one for the exact code (Rust → Solidity) and
            the live transaction. Below the run are two jobs already settled on-chain you can inspect.
          </p>
        </div>
        <a className="exp-contract mono" href={snowtraceAddr(LATCH)} target="_blank" rel="noreferrer">
          <span className="live" /> {LATCH.slice(0, 10)}…{LATCH.slice(-6)} ↗
        </a>
      </header>

      <div className="job-card">
        <div className="job-card-head">
          <span className="label"><span className="i">JOB</span>What the agent is hired to do</span>
          <a className="job-docs" href="/docs">How it all works ↗</a>
        </div>
        <p className="lead" style={{ margin: "10px 0 18px", fontSize: 16 }}>
          A buyer hires an AI agent to <b>classify three clues</b> into the single animal each
          describes. The correct answers (<span className="mono">cat · dog · bird</span>) are committed
          on-chain as a hidden answer key <i>before</i> any work starts, so the provider can't see the
          test and the buyer can't change it after.
        </p>
        <div className="job-clues">
          {task ? (
            Object.entries(task).map(([k, v]) => (
              <div className="clue" key={k}>
                <span className="clue-k mono">{k}</span>
                <span className="clue-v">{v}</span>
              </div>
            ))
          ) : (
            <div className="clue"><span className="clue-v">Loading the task…</span></div>
          )}
        </div>
        <div className="job-modes">
          <div className="job-mode pass">
            <b>Honest provider</b> reads the clues → answers correctly → verifier passes it → it gets paid.
          </div>
          <div className="job-mode fail">
            <b>Scammer provider</b> is denied the clues → returns confident, well-formed garbage →
            verifier fails it → bond slashed, buyer refunded.
          </div>
        </div>
      </div>

      <div className="run-bar">
        <span className="run-label">Run a live job:</span>
        <button className="btn btn-primary" disabled={phase === "running"} onClick={() => run("honest")}>
          Honest provider
        </button>
        <button className="btn" disabled={phase === "running"} onClick={() => run("fail")}>
          Scammer provider
        </button>
        {phase === "running" && <span className="run-status mono">running on Fuji…</span>}
        {phase === "done" && <span className="run-status mono ok">settled ✓</span>}
        {phase === "error" && <span className="run-status mono err">{errMsg}</span>}
        {engine && (
          <span className="engine-badge mono" title="The provider agents are real LLM calls">
            <span className="live" /> AI engine: {engine}
          </span>
        )}
      </div>

      {(balances || countdown !== null) && (
        <div className="wallet-meter">
          {balances && (
            <>
              <WalletCard
                key={`b${flash}`}
                role="Buyer wallet"
                desc="the agent that pays for the work"
                amount={balances.buyer}
                delta={delta?.buyer}
                accent="buy"
              />
              <div className="wallet-flow">
                <span className="wallet-flow-line" />
                <span className="mono">escrow</span>
                <span className="wallet-flow-line" />
              </div>
              <WalletCard
                key={`p${flash}`}
                role="Provider wallet"
                desc="the agent that does the work + stakes a bond"
                amount={balances.provider}
                delta={delta?.provider}
                accent="prov"
              />
            </>
          )}
          {countdown !== null && (
            <div className="wallet-card countdown">
              <span className="wallet-role">Challenge window</span>
              <span className="wallet-amt mono red">{countdown}s</span>
              <span className="wallet-desc">time left to dispute before settle</span>
            </div>
          )}
        </div>
      )}

      <div className="exp-sublabel mono">
        {live ? "Your live run, and two reference jobs settled earlier on Fuji:" : "Two reference jobs already settled on Fuji, every hash is real and clickable:"}
      </div>
      <div className="exp-tabs">
        {jobs.map((j, i) => {
          const isLive = live !== null && i === 0;
          const p = j.settled?.pass;
          const cls = isLive && phase === "running" ? "run" : p === true ? "pass" : p === false ? "fail" : "idle";
          return (
            <button
              key={i}
              className={`exp-tab${i === idx ? " active" : ""} t-${cls}`}
              onClick={() => {
                setIdx(i);
                setSelKey("create");
              }}
            >
              <span className="et-dot" />
              <span className="et-label">{j.label}</span>
              <span className="et-meta">{isLive ? "live" : `job #${j.id.toString()}`} · {usdc(j.amount)}</span>
            </button>
          );
        })}
      </div>

      <div className={`exp-flowwrap ${job.settled?.pass === false ? "is-fail" : "is-pass"}`}>
        <Workflow steps={steps} selected={step?.key ?? ""} onSelect={setSelKey} running={isLiveSelected ? running ?? undefined : undefined} />
      </div>

      {step && <NodeDetail step={step} />}
    </div>
  );
}
