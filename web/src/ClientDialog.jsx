import { useState } from "react";

// The dialog a compliant MCP client shows (spec 2025-11-25, client/elicitation). The "client does" list is what THIS lab client
// promises; the server cannot change it.
function Field({ f, value, onChange, error }) {
  const id = `f-${f.name}`;
  const label = <label htmlFor={id}>{f.label}{f.required ? " *" : ""}</label>;
  let input;
  if (f.kind === "boolean") input = <input id={id} type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} />;
  else if (f.kind === "select") input = <select id={id} value={value ?? ""} onChange={(e) => onChange(e.target.value)}><option value="">choose…</option>{f.options.map((o) => <option key={o.value ?? o} value={o.value ?? o}>{o.label ?? o}</option>)}</select>;
  else if (f.kind === "multiselect") input = (
    <fieldset id={id} className="field__multi">{f.options.map((o) => { const v = o.value ?? o; const on = (value ?? []).includes(v); return (
      <label key={v} className="check"><input type="checkbox" checked={on} onChange={() => onChange(on ? (value ?? []).filter((x) => x !== v) : [...(value ?? []), v])} /> {o.label ?? o}</label>); })}</fieldset>
  );
  else if (f.kind === "number") input = <input id={id} type="number" value={value ?? ""} min={f.min ?? undefined} max={f.max ?? undefined} onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))} />;
  else input = <input id={id} type={f.format === "date" ? "date" : f.format === "email" ? "email" : "text"} value={value ?? ""} maxLength={f.max ?? undefined} onChange={(e) => onChange(e.target.value)} />;
  return (
    <div className="field">{label}{input}
      {f.description && <small className="muted">{f.description}</small>}
      {error && <small className="field-error" role="alert">{error}</small>}
    </div>
  );
}

export default function ClientDialog({ pending, onRespond, busy }) {
  const [values, setValues] = useState(() => Object.fromEntries((pending.fields ?? []).filter((f) => f.default !== null).map((f) => [f.name, f.default])));
  const isUrl = pending.kind === "url";
  const clean = () => Object.fromEntries(Object.entries(values).filter(([, v]) => v !== "" && v !== undefined));
  // aria-disabled, not disabled: the button keeps keyboard focus while a request is in flight, and a press during that time does nothing.
  const act = (action) => () => { if (!busy) onRespond(action); };
  return (
    <section className="dialog" role="group" aria-label="Client dialog">
      <p className="dialog__who"><strong>{pending.server.name}</strong> v{pending.server.version} is asking</p>
      <p>{pending.message}</p>
      {!isUrl && (
        <form noValidate onSubmit={(e) => { e.preventDefault(); if (!busy) onRespond("accept", clean()); }}>
          {pending.fields.map((f) => <Field key={f.name} f={f} value={values[f.name]} error={pending.errors?.[f.name]} onChange={(v) => setValues((s) => ({ ...s, [f.name]: v }))} />)}
          {pending.errors && Object.keys(pending.errors).some((k) => !pending.fields.some((f) => f.name === k)) && <p className="field-error" role="alert">{Object.entries(pending.errors).filter(([k]) => !pending.fields.some((f) => f.name === k)).map(([k, m]) => `${k}: ${m}`).join("; ")}</p>}
          <div className="dialog__buttons">
            <button type="submit" className="primary" aria-disabled={busy}>Submit (accept)</button>
            <button type="button" aria-disabled={busy} onClick={act("decline")}>Decline</button>
            <button type="button" aria-disabled={busy} onClick={act("cancel")}>Cancel</button>
          </div>
        </form>
      )}
      {isUrl && (
        <>
          <p className="dialog__url" aria-label="Full URL"><code>{pending.url.full}</code></p>
          {pending.url.valid && <p>Domain: {pending.url.subdomain && <span className="dialog__sub">{pending.url.subdomain}.</span>}<strong className="dialog__apex">{pending.url.apex}</strong></p>}
          {pending.url.warnings.map((w) => <p key={w} className="dialog__warn" role="alert">{w}</p>)}
          <p className="muted">Nothing opens until you consent. Accepting means "open it", not "it is done".</p>
          <div className="dialog__buttons">
            <button className="primary" aria-disabled={busy || !pending.url.valid} onClick={() => { if (!busy && pending.url.valid) onRespond("accept"); }}>Open this URL (consent)</button>
            <button aria-disabled={busy} onClick={act("decline")}>Decline</button>
            <button aria-disabled={busy} onClick={act("cancel")}>Cancel</button>
          </div>
        </>
      )}
      <details className="compliance"><summary>What this client does (spec rules)</summary>
        <ul>{pending.compliance.map((c) => <li key={c.text}><span className="lvl" data-level={c.level}>{c.level}</span> {c.text}</li>)}</ul>
      </details>
    </section>
  );
}
