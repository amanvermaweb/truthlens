import { connectToDatabase } from "@/lib/mongodb";

type HistoryRecord = {
  id: string;
  claim: string;
  verdict: string;
  confidence: number;
  createdAt: Date;
};

function formatRelativeTime(value: Date) {
  const diffMs = Date.now() - value.getTime();
  const diffMinutes = Math.max(1, Math.floor(diffMs / 60000));

  if (diffMinutes < 60) return `${diffMinutes}m ago`;

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 30) return `${diffDays}d ago`;

  return value.toLocaleDateString();
}

async function getHistoryRecords() {
  const client = await connectToDatabase();
  const db = client.db("truth-lens");
  const docs = await db
    .collection("claims")
    .find(
      {},
      {
        projection: {
          claim: 1,
          verdict: 1,
          confidence: 1,
          createdAt: 1,
        },
      },
    )
    .sort({ createdAt: -1 })
    .limit(50)
    .toArray();

  return docs.map((entry) => ({
    id: entry._id.toString(),
    claim: String(entry.claim ?? "Untitled claim"),
    verdict: String(entry.verdict ?? "Mixed"),
    confidence: Number(entry.confidence ?? 0),
    createdAt:
      entry.createdAt instanceof Date
        ? entry.createdAt
        : new Date(entry.createdAt ?? Date.now()),
  })) as HistoryRecord[];
}

export default async function HistoryPage() {
  const records = await getHistoryRecords();

  return (
    <section className="mx-auto w-full max-w-275 px-4 pb-20 pt-10 sm:px-6">
      <p className="label-sm text-muted">Archive</p>
      <h1 className="headline-md mt-2 text-high sm:text-4xl">
        Verification History
      </h1>
      <p className="mt-3 max-w-2xl body-md text-muted">
        Recent investigations and verdict trails saved by your team.
      </p>

      {records.length === 0 ? (
        <div className="card-surface mt-8 p-6 text-sm text-muted">
          No verification history yet. Run your first claim from the home page.
        </div>
      ) : (
        <div className="list-airy mt-8 grid gap-0">
          {records.map((entry) => (
            <article key={entry.id} className="card-surface flex flex-wrap items-center justify-between gap-4 p-6">
              <div>
                <p className="label-sm text-muted">
                  {entry.id.slice(-6).toUpperCase()}
                </p>
                <h2 className="title-sm mt-2 text-high">{entry.claim}</h2>
              </div>
              <div className="flex items-center gap-4">
                <span className="rounded-full bg-(--surface-container-high) px-3 py-1 text-sm text-high">
                  {entry.verdict}
                </span>
                <span className="text-sm text-muted">{entry.confidence}%</span>
                <span className="text-sm text-muted">{formatRelativeTime(entry.createdAt)}</span>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
