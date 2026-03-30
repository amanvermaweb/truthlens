import { ClaimPayload } from "@/lib/types";
import { useMemo, useState } from "react";
import { reliabilityTone, sortByCredibility } from "./dashboard-utils";

type SourcesEvidencePanelProps = {
  claimData: ClaimPayload;
};

export function SourcesEvidencePanel({ claimData }: SourcesEvidencePanelProps) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const sourceNodes = useMemo(() => claimData.sourceNodes ?? [], [claimData.sourceNodes]);

  const groupedCards = useMemo(
    () =>
      sortByCredibility(sourceNodes).map((node) => ({
        ...node,
        expanded: !!expanded[node.id],
      })),
    [expanded, sourceNodes],
  );

  return (
    <aside className="glass-panel p-4">
      <h2 className="label-sm px-2 text-muted">Sources & Evidence</h2>
      <div className="mt-4 space-y-3">
        {groupedCards.map((item) => (
          <article key={item.id} className="card-surface rounded-2xl p-4">
            <div className="flex items-center justify-between gap-2">
              <p className="label-sm text-muted">{item.source}</p>
              <span className={`rounded-full px-2 py-0.5 text-xs ${reliabilityTone(item.credibility)}`}>
                {item.credibility}/100
              </span>
            </div>
            <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-muted">
              <span className="rounded-full bg-(--surface-container-high) px-2 py-0.5">{item.tier ?? "Tier ?"}</span>
              {typeof item.recencyScore === "number" ? (
                <span className="rounded-full bg-(--surface-container-high) px-2 py-0.5">
                  Recency {item.recencyScore}%
                </span>
              ) : null}
            </div>
            <h3 className="title-sm mt-2 leading-6 text-high">{item.title}</h3>

            <button
              className="btn-tertiary mt-2 transition hover:text-high"
              onClick={() => setExpanded((prev) => ({ ...prev, [item.id]: !prev[item.id] }))}
            >
              {item.expanded ? "Hide summary" : "Expand summary"}
            </button>

            {item.expanded ? <p className="body-md mt-2 text-muted">{item.summary}</p> : null}
          </article>
        ))}
      </div>
    </aside>
  );
}
