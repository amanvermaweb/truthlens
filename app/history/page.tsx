const records = [
  {
    id: "TL-0291",
    claim: "Shipping delays in Q3 are tied to isolated port strikes.",
    verdict: "Likely True",
    confidence: 94,
    time: "2h ago",
  },
  {
    id: "TL-0288",
    claim: "Inflation spike was caused only by domestic demand.",
    verdict: "Misleading",
    confidence: 71,
    time: "1d ago",
  },
  {
    id: "TL-0279",
    claim: "Carbon output fell by 22% in one quarter globally.",
    verdict: "Likely False",
    confidence: 89,
    time: "3d ago",
  },
];

export default function HistoryPage() {
  return (
    <section className="mx-auto w-full max-w-275 px-4 pb-20 pt-10 sm:px-6">
      <p className="label-sm text-muted">Archive</p>
      <h1 className="headline-md mt-2 text-high sm:text-4xl">
        Verification History
      </h1>
      <p className="mt-3 max-w-2xl body-md text-muted">
        Recent investigations and verdict trails saved by your team.
      </p>

      <div className="list-airy mt-8 grid gap-0">
        {records.map((entry) => (
          <article key={entry.id} className="card-surface flex flex-wrap items-center justify-between gap-4 p-6">
            <div>
              <p className="label-sm text-muted">
                {entry.id}
              </p>
              <h2 className="title-sm mt-2 text-high">{entry.claim}</h2>
            </div>
            <div className="flex items-center gap-4">
              <span className="rounded-full bg-(--surface-container-high) px-3 py-1 text-sm text-high">
                {entry.verdict}
              </span>
              <span className="text-sm text-muted">{entry.confidence}%</span>
              <span className="text-sm text-muted">{entry.time}</span>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
