export default function SpecPanel({ spec }) {
  if (!spec) return null;
  return (
    <details className="spec"><summary>Spec basis and what this lab did not read</summary>
      <p>Targets protocol revision <strong>{spec.protocol}</strong>. Sources read in full on {spec.read}. The links are shown for you to follow; this lab never fetches them:</p>
      <ul>{spec.pages.map((p) => <li key={p.id}><a href={p.url} rel="noreferrer noopener" target="_blank">{p.id}</a>: {p.status}</li>)}</ul>
      <p>Not read, so anything about them is UNVERIFIED: {spec.notRead.join(", ")}.</p>
      <h3>How the draft differs</h3>
      <ul>{spec.draftDifferences.map((d) => <li key={d}>{d}</li>)}</ul>
    </details>
  );
}
