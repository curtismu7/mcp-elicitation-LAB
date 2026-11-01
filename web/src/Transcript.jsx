const ARROW = { "client→server": "Client → Server", "server→client": "Server → Client", person: "Person", client: "Client", browser: "Browser", server: "Server" };

// The raw JSON-RPC, because this is education: every message is shown as sent, with its W3C traceparent (rule 14).
export default function Transcript({ transcript, shown }) {
  return (
    <ol className="transcript" aria-label="Protocol transcript">
      {transcript.slice(0, shown).map((m) => (
        <li key={m.n} className="msg" data-kind={m.kind}>
          <span className="msg__dir">{ARROW[m.dir] ?? m.dir}</span>
          <span className="msg__what">{m.method ?? (m.json?.error ? `error ${m.json.error.code}` : m.json?.result ? "response" : m.kind)}</span>
          {m.note && <span className="msg__note">{m.note}</span>}
          {m.json && <details className="msg__json"><summary>JSON-RPC</summary><pre aria-label={`Message ${m.n}`}>{JSON.stringify(m.json, null, 2)}</pre><small className="muted">traceparent {m.traceparent}</small></details>}
        </li>
      ))}
    </ol>
  );
}
