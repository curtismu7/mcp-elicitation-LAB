export default function Findings({ findings, expected }) {
  return (
    <section aria-label="Findings">
      <h2>Findings</h2>
      {findings.length === 0 && <p className="ok">No server-side rule was broken in this run.</p>}
      <ul className="findings">
        {findings.map((f, i) => (
          <li key={`${f.id}-${i}`} className="finding">
            <span className="lvl" data-level={f.level}>{f.level}</span> <strong>{f.title}</strong>
            <span className="finding__who">{f.who === "server" ? "server" : "client"} rule</span>
            <p>{f.text}</p>
            {f.detail && <p className="muted">{f.detail}</p>}
            <small className="muted">Source: spec {f.cite}</small>
          </li>
        ))}
      </ul>
      {expected && <p className="muted">Expected for this scenario: {expected.length ? expected.join(", ") : "none"}.</p>}
    </section>
  );
}
