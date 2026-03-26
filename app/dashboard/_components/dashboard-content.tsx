"use client";

import { ClaimPayload, SourceNode } from "@/lib/types";
import { useMemo, useState } from "react";
import { reliabilityTone, sortByCredibility, verdictTone } from "./dashboard-utils";

type DashboardContentProps = {
  claimData: ClaimPayload;
  error: string | null;
};

export function DashboardContent({ claimData, error }: DashboardContentProps) {
  const [activeNode, setActiveNode] = useState<SourceNode | null>(null);
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
    <div className="grid gap-4 lg:grid-cols-[280px_1fr_320px]">
      <aside className="glass-panel p-5">
        <p className="label-sm text-muted">Extracted Claim</p>
        <p className="headline-md mt-3 leading-tight text-high">{claimData.claim}</p>

        <div className="mt-5 flex flex-wrap gap-2">
          {(claimData.tags ?? ["General"]).map((tag) => (
            <span
              key={tag}
              className="rounded-full bg-(--surface-container-high) px-3 py-1 text-xs text-high"
            >
              {tag}
            </span>
          ))}
        </div>

        <div
          className={`mt-6 rounded-2xl px-4 py-3 text-sm font-medium ${verdictTone(claimData.verdict)}`}
        >
          {claimData.verdict}
        </div>

        <div className="mt-6 rounded-2xl bg-(--surface-container-lowest) p-4">
          <div className="mx-auto grid h-28 w-28 place-items-center rounded-full bg-(--surface-container-low) ring-4 ring-(--accent)/35">
            <span className="headline-md text-high">{claimData.confidence}%</span>
          </div>
          <p className="label-sm mt-3 text-center text-muted">Confidence</p>
        </div>

        <div className="insight-panel mt-6 p-4 text-sm leading-6 text-muted">
          {claimData.analysisSummary}
        </div>
      </aside>

      <main className="glass-panel relative overflow-hidden p-5">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="label-sm text-muted">Evidence Graph</h2>
          <p className="text-xs text-muted">Green supports. Red contradicts.</p>
        </div>

        <div className="graph-surface relative h-140 overflow-hidden rounded-3xl bg-(--surface-container-lowest)">
          <svg className="absolute inset-0 h-full w-full" aria-hidden>
            {sourceNodes.map((node) => (
              <line
                key={`${node.id}-edge`}
                x1="50%"
                y1="52%"
                x2={`${node.x}%`}
                y2={`${node.y}%`}
                stroke={
                  node.relation === "supports"
                    ? "rgba(16, 185, 129, 0.8)"
                    : node.relation === "contradicts"
                      ? "rgba(244, 63, 94, 0.7)"
                      : "rgba(148, 163, 184, 0.65)"
                }
                strokeDasharray="6 6"
                strokeWidth="1.5"
              />
            ))}
          </svg>

          {sourceNodes.map((node) => (
            <button
              key={node.id}
              className={`graph-node absolute -translate-x-1/2 -translate-y-1/2 rounded-xl px-3 py-2 text-xs transition ${
                node.relation === "supports"
                  ? "bg-emerald-500/10 text-emerald-200"
                  : node.relation === "contradicts"
                    ? "bg-rose-500/10 text-rose-200"
                    : "bg-slate-500/15 text-slate-200"
              }`}
              style={{ left: `${node.x}%`, top: `${node.y}%` }}
              onMouseEnter={() => setActiveNode(node)}
              onMouseLeave={() => setActiveNode(null)}
            >
              {node.label}
            </button>
          ))}

          {sourceNodes.length === 0 ? (
            <div className="absolute inset-0 grid place-items-center px-6 text-center text-sm text-muted">
              No supporting sources were generated for this claim.
            </div>
          ) : null}

          <div className="pulse-node absolute left-1/2 top-[52%] grid h-24 w-24 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-(--accent)/10 text-sm font-semibold text-high">
            Claim
          </div>

          <div
            className={`insight-panel absolute bottom-4 right-4 max-w-[320px] p-4 text-sm transition ${
              activeNode
                ? "opacity-100 translate-y-0"
                : "pointer-events-none opacity-0 translate-y-2"
            }`}
          >
            <p className="title-sm text-high">{activeNode?.title}</p>
            <p className="label-sm mt-1 text-muted">{activeNode?.source}</p>
            <p className="body-md mt-2 text-muted">{activeNode?.summary}</p>
          </div>
        </div>

        <p className="label-sm mt-4 text-muted">
          {error
            ? `Refresh issue: ${error}`
            : "Graph positions are generated from source relevance and confidence drift."}
        </p>
      </main>

      <aside className="glass-panel p-4">
        <h2 className="label-sm px-2 text-muted">Sources & Evidence</h2>
        <div className="mt-4 space-y-3">
          {groupedCards.map((item) => (
            <article key={item.id} className="card-surface rounded-2xl p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="label-sm text-muted">{item.source}</p>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs ${reliabilityTone(item.credibility)}`}
                >
                  {item.credibility}/100
                </span>
              </div>
              <h3 className="title-sm mt-2 leading-6 text-high">{item.title}</h3>

              <button
                className="btn-tertiary mt-2 transition hover:text-high"
                onClick={() =>
                  setExpanded((prev) => ({ ...prev, [item.id]: !prev[item.id] }))
                }
              >
                {item.expanded ? "Hide summary" : "Expand summary"}
              </button>

              {item.expanded ? <p className="body-md mt-2 text-muted">{item.summary}</p> : null}
            </article>
          ))}
        </div>
      </aside>
    </div>
  );
}
