import { useCallback, useEffect, useRef, useState } from "react";
import FlowDiagram from "./FlowDiagram.jsx";
import ClientDialog from "./ClientDialog.jsx";
import Transcript from "./Transcript.jsx";
import Findings from "./Findings.jsx";
import SpecPanel from "./SpecPanel.jsx";
import TalkTrack from "./TalkTrack.jsx";
import { getDiagram, getInfo, getScenarios, getSpec, getTalkTrack, postMode, resetServer, respond, startRun } from "./api.js";
import ShelfLink from "./components/ShelfLink.jsx";
import { workspaceId } from "./workspace.js";

const SPEEDS = [0.5, 1, 2, 4];
const CAPS = { default: undefined, both: { form: {}, url: {} }, form: { form: {} }, url: { url: {} }, empty: {}, none: null };
const CAP_LABEL = { default: "as the scenario sets", both: "form + url", form: "form only", url: "url only", empty: "{} (means form only)", none: "none (no elicitation)" };
const dialogKey = (run) => (run?.status === "awaiting_user" && run.pending ? `${run.id}-${run.transcript.filter((m) => m.method === "elicitation/create").length}-${run.pending.elicitationId ?? ""}` : null);
const STATUS = { running: "running", awaiting_user: "waiting for the person", done: "done", failed: "failed" };
const DIAGRAM = "elicitation-actors";
const THEME_KEY = "mce.theme";
const THEMES = [["auto", "Auto"], ["light", "Light"], ["dark", "Dark"]];
function initialTheme() {
  try { const t = localStorage.getItem(THEME_KEY); if (t === "light" || t === "dark") return t; } catch { /* storage blocked */ }
  return "auto";
}
const LIVE_FALLBACK = "Live mode is not available in this lab. It stays on Mock.";
// The banner is never blank and always names the mode. This lab only has mock; the same text shows in presenter mode.
export const BANNER = "MOCK mode, simulated. The MCP server and the MCP client here are both mocks running inside this app. No URL you see is ever opened or fetched, and nothing leaves this machine. Real MCP clients were not probed, and the spec pages this lab did not read are UNVERIFIED.";
const hashScenario = () => { const m = /^#scenario-([a-z0-9-]{1,40})$/.exec(window.location.hash); return m ? m[1] : null; };

export default function App() {
  const [scenarios, setScenarios] = useState([]);
  const [spec, setSpec] = useState(null);
  const [info, setInfo] = useState(null);
  const [diagram, setDiagram] = useState(null);
  const [talk, setTalk] = useState(null);
  const [scenarioId, setScenarioId] = useState("");
  const [capsKey, setCapsKey] = useState("default");
  const [play, setPlay] = useState("interactive");
  const [run, setRun] = useState(null);
  const [shown, setShown] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [resetKey, setResetKey] = useState(0);
  const [resetMsg, setResetMsg] = useState("");
  const [liveMsg, setLiveMsg] = useState("");
  const [presenter, setPresenter] = useState(false);
  const [openKey, setOpenKey] = useState(null);
  const [theme, setTheme] = useState(initialTheme);
  const timer = useRef(null);

  useEffect(() => { if (theme === "auto") delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = theme; }, [theme]);

  // Rule 19: Real asks the server, which refuses with 409 and the honest reason; the page stays in Mock and the data is reloaded.
  const chooseReal = () => {
    postMode("real").then(() => setLiveMsg(""), (e) => setLiveMsg(e.message || LIVE_FALLBACK));
  };

  const pickTheme = (next) => {
    try { if (next === "auto") localStorage.removeItem(THEME_KEY); else localStorage.setItem(THEME_KEY, next); } catch { /* not remembered */ }
    setTheme(next);
  };

  useEffect(() => {
    getScenarios().then((s) => { setScenarios(s.scenarios); const wanted = hashScenario(); setScenarioId(s.scenarios.some((x) => x.id === wanted) ? wanted : s.scenarios[0]?.id ?? ""); }).catch((e) => setError(e.message));
    getSpec().then(setSpec).catch(() => {});
    getInfo().then(setInfo).catch(() => {});
    getDiagram(DIAGRAM).then(setDiagram).catch((e) => setError(e.message));
    getTalkTrack().then((t) => setTalk(t.talkTrack)).catch(() => {});
    return () => clearTimeout(timer.current);
  }, []);

  // Presenter mode: P toggles, Esc leaves. A key with a modifier is the browser's or the OS's, and a key typed into a field is text.
  useEffect(() => {
    const on = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target;
      if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) return;
      if (e.key === "p" || e.key === "P") setPresenter((v) => !v);
      else if (e.key === "Escape") setPresenter(false);
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, []);

  const transcript = run?.transcript ?? [];
  const animate = (total, from = 0) => {
    clearTimeout(timer.current); setShown(from);
    const tick = (n) => { if (n >= total) return; timer.current = setTimeout(() => { setShown(n + 1); tick(n + 1); }, 700 / speed); };
    tick(from);
  };
  async function onRun() {
    if (busy || !scenarioId) return;
    setBusy(true); setError(""); clearTimeout(timer.current); setShown(0);
    try { const r = await startRun({ scenarioId, caps: CAPS[capsKey], ...(play !== "interactive" ? { autopilot: play } : {}) }); setRun(r); animate(r.transcript.length); } catch (e) { setError(e.message); setRun(null); } finally { setBusy(false); }
  }
  async function onRespond(action, content) {
    const before = run.transcript.length;
    setBusy(true); setError("");
    try { const r = await respond(run.id, action, content); setRun(r); animate(r.transcript.length, Math.min(before, r.transcript.length)); } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  // Reset: the server forgets this workspace's runs; the page forgets the run and puts the diagram boxes back in place.
  const onReset = useCallback(async () => {
    clearTimeout(timer.current); setRun(null); setShown(0); setError(""); setResetKey((k) => k + 1);
    const ok = await resetServer().then(() => true, () => false);
    setResetMsg(ok ? "Reset: your workspace's runs are cleared and the diagram boxes are back in place." : "Reset failed on the server; the page was cleared.");
  }, []);
  const sc = scenarios.find((s) => s.id === scenarioId);
  const groups = [...new Set(scenarios.map((s) => s.group))];
  // The dialog opens once the messages leading to it have been shown, then STAYS (with what the person typed) until it is answered,
  // even while a note about a blocked submit is being revealed.
  const key = dialogKey(run);
  useEffect(() => { if (!key) setOpenKey(null); else if (shown >= transcript.length) setOpenKey(key); }, [key, shown, transcript.length]);
  const waiting = Boolean(key) && (shown >= transcript.length || key === openKey);
  const say = talk ? talk.filter((t) => t.for.includes(sc?.group)) : [];

  return (
    <div className={`app${presenter ? " app--presenter" : ""}`}>
      <header className="head">
        <p className="banner" role="note" data-state="mock" data-testid="banner">{BANNER}</p>
        <div className="head__row">
          <div>
            <h1 className="head__title">MCP Elicitation LAB</h1>
            {!presenter && <p className="head__intro">An MCP server in the middle of a tool call needs more from the person. It asks the client, in <strong>form</strong> mode or <strong>URL</strong> mode, and the person can accept, decline or cancel. Pick a scenario, change what the client declares, and watch the messages, the dialog and the rules.</p>}
          </div>
          <div className="head__tools">
            <ShelfLink headers={() => ({ "x-workspace": workspaceId() })} />
            <div className="seg" role="group" aria-label="Mode">
              <button type="button" aria-pressed="true" onClick={() => setLiveMsg("")} data-testid="mode-mock">Mock</button>
              <button type="button" aria-pressed="false" aria-disabled={info?.realAvailable === false ? "true" : undefined}
                title={info?.realAvailable === false && info?.realReason ? info.realReason : undefined}
                onClick={chooseReal} data-testid="mode-real">Real</button>
            </div>
            <span className="chip" data-testid="mode">Mode: mock (in-process mocks)</span>
            <label className="shell-theme">Theme
              <select value={theme} onChange={(e) => pickTheme(e.target.value)}>
                {THEMES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
              </select>
            </label>
            <button type="button" onClick={onReset} data-testid="reset">Reset</button>
            <button type="button" aria-pressed={presenter} onClick={() => setPresenter((v) => !v)} data-testid="presenter">{presenter ? "Exit presenter (Esc)" : "Presenter (P)"}</button>
          </div>
        </div>
        {liveMsg && <p className="field-error" role="status" data-testid="live-refusal">{liveMsg}</p>}
      </header>

      <main>
        <p className="sr-only" role="status" aria-live="polite">{resetMsg}</p>
        {presenter && say.length > 0 && (
          <aside className="presenter-say" data-testid="presenter-say" aria-label="Talk track for this scenario">
            {say.map((t) => <p key={t.id}><strong>{t.title}.</strong> {t.say}</p>)}
          </aside>
        )}
        <section className="controls" aria-label="Run controls">
          <label>Scenario
            <select value={scenarioId} onChange={(e) => setScenarioId(e.target.value)}>
              {groups.map((g) => <optgroup key={g} label={g}>{scenarios.filter((s) => s.group === g).map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}</optgroup>)}
            </select>
          </label>
          <label>Client declares
            <select value={capsKey} onChange={(e) => setCapsKey(e.target.value)}>{Object.entries(CAP_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          </label>
          <label>The person
            <select value={play} onChange={(e) => setPlay(e.target.value)}>
              <option value="interactive">decides (I choose)</option><option value="accept">accepts (autopilot)</option><option value="decline">declines (autopilot)</option><option value="cancel">cancels (autopilot)</option>
            </select>
          </label>
          <label>Speed
            <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>{SPEEDS.map((s) => <option key={s} value={s}>{s}x</option>)}</select>
          </label>
          <button className="primary" aria-disabled={busy || !scenarioId} onClick={onRun}>{busy ? "Running…" : "Run"}</button>
          <button aria-disabled={!run} onClick={() => { if (run) animate(transcript.length); }}>Simulate again</button>
        </section>
        {sc && <p className="muted">{sc.blurb} Spec: {sc.spec.join("; ")}.</p>}
        {error && <p className="field-error" role="alert">{error}</p>}

        <FlowDiagram diagram={diagram} transcript={transcript} shown={shown} resetKey={resetKey} />

        {waiting && <ClientDialog key={key} pending={run.pending} onRespond={onRespond} busy={busy} />}

        {run && (
          <>
            <h2>Messages <span className="status" data-state={run.status}>{STATUS[run.status] ?? run.status}</span></h2>
            <p className="muted">Client declared: <code>{run.caps === null ? "no elicitation capability" : JSON.stringify({ elicitation: run.caps })}</code> trace {run.traceId}</p>
            <Transcript transcript={transcript} shown={shown} />
            {run.outcome && shown >= transcript.length && <p className="outcome" role="status" data-testid="outcome"><strong>Outcome:</strong> {run.outcome}</p>}
            {shown >= transcript.length && <Findings findings={run.findings} expected={sc?.expectedFindings} />}
          </>
        )}
        {!presenter && <TalkTrack talk={talk} />}
        {!presenter && <SpecPanel spec={spec} />}
      </main>
    </div>
  );
}
