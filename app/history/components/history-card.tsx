import { formatRelativeTime } from "@/lib/date-format";
import { HistoryRecord } from "@/lib/types";
import Link from "next/link";

type HistoryCardProps = {
  entry: HistoryRecord;
};

function HistoryCardBody({ entry }: HistoryCardProps) {
  return (
    <article className="flex flex-wrap items-center justify-between gap-4 p-6">
      <div>
        <p className="label-sm text-muted">{entry.id.slice(-6).toUpperCase()}</p>
        <h2 className="title-sm mt-2 text-high">{entry.claim}</h2>
      </div>
      <div className="flex items-center gap-4">
        <span className="rounded-full bg-(--surface-container-high) px-3 py-1 text-sm text-high">
          {entry.verdict}
        </span>
        <span className="text-sm text-muted">{entry.confidence}%</span>
        <span className="text-sm text-muted">
          {formatRelativeTime(entry.createdAt)}
        </span>
      </div>
    </article>
  );
}

export function HistoryCard({ entry }: HistoryCardProps) {
  if (!entry.analysisId) {
    return (
      <div className="card-surface">
        <HistoryCardBody entry={entry} />
      </div>
    );
  }

  return (
    <Link
      href={{ pathname: "/dashboard", query: { claimId: entry.analysisId } }}
      className="card-surface block transition hover:bg-(--surface-container-high) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--accent)"
    >
      <HistoryCardBody entry={entry} />
    </Link>
  );
}
