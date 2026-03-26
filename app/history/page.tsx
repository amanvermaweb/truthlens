import { HistoryCard } from "@/app/history/_components/history-card";
import { getHistory } from "@/lib/fact-check";
import { HistoryRecord } from "@/lib/types";
import { connection } from "next/server";

async function getHistoryRecords() {
  try {
    const rows = await getHistory(50);
    const records: HistoryRecord[] = rows.map((entry) => ({
      id: entry.queryId || entry.resultId,
      analysisId: entry.resultId || "",
      claim: String(entry.input ?? "Untitled claim"),
      verdict: entry.verdict,
      confidence: Number(entry.confidence ?? 0),
      createdAt:
        entry.createdAt instanceof Date
          ? entry.createdAt
          : new Date(entry.createdAt ?? Date.now()),
    }));

    return records;
  } catch (error) {
    console.error("Failed to load history records", error);
    return [];
  }
}

export default async function HistoryPage() {
  await connection();
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
            <HistoryCard key={entry.id} entry={entry} />
          ))}
        </div>
      )}
    </section>
  );
}
