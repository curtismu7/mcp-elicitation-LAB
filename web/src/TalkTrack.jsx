// The talk track, rendered from the same data as docs/talk-track.md.
export default function TalkTrack({ talk }) {
  if (!talk) return null;
  return (
    <section className="panel" aria-label="Talk track">
      <h2>Talk track</h2>
      <ol className="talk" data-testid="talk-track">
        {talk.map((t) => <li key={t.id}><h3>{t.title}</h3><p>{t.say}</p></li>)}
      </ol>
    </section>
  );
}
