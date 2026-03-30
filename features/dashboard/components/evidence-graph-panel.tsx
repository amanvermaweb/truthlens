import { ClaimPayload, SourceNode } from "@/lib/types";
import { useMemo, useState } from "react";

type EvidenceGraphPanelProps = {
  claimData: ClaimPayload;
  error: string | null;
};

export function EvidenceGraphPanel({ claimData, error }: EvidenceGraphPanelProps) {
  const [activeNode, setActiveNode] = useState<SourceNode | null>(null);
  const sourceNodes = useMemo(() => claimData.sourceNodes ?? [], [claimData.sourceNodes]);
  const misleadingSegments = claimData.misleadingSegments ?? [];
  const subClaims = claimData.subClaims ?? [];

  return (
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
            activeNode ? "opacity-100 translate-y-0" : "pointer-events-none opacity-0 translate-y-2"
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

      {subClaims.length > 0 ? (
        <div className="mt-5 rounded-2xl bg-(--surface-container-lowest) p-4">
          <h3 className="label-sm text-muted">Claim Decomposition</h3>
          <div className="mt-3 space-y-3">
            {subClaims.map((subClaim) => (
              <article key={subClaim.id} className="rounded-xl bg-(--surface-container-low) p-3">
                <p className="text-sm text-high">{subClaim.statement}</p>
                <p className="mt-2 text-xs text-muted">
                  Supports: {subClaim.supportCount} | Contradicts: {subClaim.contradictionCount} | Neutral: {subClaim.unresolvedCount}
                </p>
              </article>
            ))}
          </div>
        </div>
      ) : null}

      {misleadingSegments.length > 0 ? (
        <div className="mt-5 rounded-2xl bg-(--surface-container-lowest) p-4">
          <h3 className="label-sm text-muted">Misleading Language Signals</h3>
          <div className="mt-3 space-y-2">
            {misleadingSegments.map((segment) => (
              <article key={`${segment.text}-${segment.reason}`} className="rounded-xl bg-(--surface-container-low) p-3">
                <p className="text-sm text-high">{segment.text}</p>
                <p className="mt-1 text-xs text-muted">{segment.reason}</p>
              </article>
            ))}
          </div>
        </div>
      ) : null}
    </main>
  );
}
