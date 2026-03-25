"use client";

import { useEffect, useMemo, useState } from "react";

type SourceNode = {
  id: string;
  label: string;
  title: string;
  source: string;
  credibility: number;
  relation: "supports" | "contradicts";
  summary: string;
  x: number;
  y: number;
};

const sourceNodes: SourceNode[] = [
  {
    id: "reuters",
    label: "Reuters",
    title: "Quarterly Logistics & Port Congestion Index (Q3 2023)",
    source: "Reuters Intelligence",
    credibility: 95,
    relation: "supports",
    summary: "Confirms localized strike concentration in two terminal clusters.",
    x: 28,
    y: 22,
  },
  {
    id: "world-bank",
    label: "World Bank",
    title: "Global Trade Bulletin - Disruption Pattern Review",
    source: "World Bank Data",
    credibility: 91,
    relation: "supports",
    summary: "Shows systemic markers below long-term disruption threshold.",
    x: 75,
    y: 26,
  },
  {
    id: "audit-bureau",
    label: "Audit Bureau",
    title: "Independent Terminal Throughput Audit",
    source: "Port Audit Bureau",
    credibility: 89,
    relation: "supports",
    summary: "Throughput decline is uneven and concentrated near strike windows.",
    x: 28,
    y: 74,
  },
  {
    id: "local-oped",
    label: "Local Op-Ed",
    title: "The End of Global Supply Chains",
    source: "Regional Editorial",
    credibility: 42,
    relation: "contradicts",
    summary: "High rhetoric, weak citation trail, broad unsupported claims.",
    x: 72,
    y: 76,
  },
];

function reliabilityTone(score: number) {
  if (score >= 80) return "text-emerald-300 bg-emerald-500/10";
  if (score >= 60) return "text-amber-300 bg-amber-500/10";
  return "text-rose-300 bg-rose-500/10";
}

export default function DashboardPage() {
  const [loading, setLoading] = useState(true);
  const [activeNode, setActiveNode] = useState<SourceNode | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const timer = setTimeout(() => setLoading(false), 1200);
    return () => clearTimeout(timer);
  }, []);

  const groupedCards = useMemo(
    () =>
      sourceNodes
        .slice()
        .sort((a, b) => b.credibility - a.credibility)
        .map((node) => ({
          ...node,
          expanded: !!expanded[node.id],
        })),
    [expanded],
  );

  return (
    <section className="mx-auto w-full max-w-350 px-4 pb-16 pt-8 sm:px-6 lg:px-8">
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <p className="label-sm text-muted">Analysis Engine</p>
          <h1 className="headline-md mt-2 text-high">
            Evidence Connectivity Dashboard
          </h1>
        </div>
        <button className="btn-primary h-11 px-5 text-sm">New Verification</button>
      </div>

      {loading ? (
        <div className="grid gap-4 lg:grid-cols-[280px_1fr_320px]">
          <div className="glass-panel p-5">
            <div className="skeleton h-4 w-24" />
            <div className="mt-4 space-y-3">
              <div className="skeleton h-4 w-full" />
              <div className="skeleton h-4 w-10/12" />
              <div className="skeleton h-4 w-9/12" />
            </div>
            <div className="mt-6 skeleton h-28 w-full rounded-2xl" />
          </div>

          <div className="glass-panel p-5">
            <div className="skeleton h-5 w-48" />
            <div className="mt-6 skeleton h-130 w-full rounded-3xl" />
          </div>

          <div className="glass-panel p-5">
            <div className="skeleton h-5 w-36" />
            <div className="mt-5 space-y-3">
              <div className="skeleton h-24 w-full rounded-2xl" />
              <div className="skeleton h-24 w-full rounded-2xl" />
              <div className="skeleton h-24 w-full rounded-2xl" />
            </div>
          </div>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[280px_1fr_320px]">
          <aside className="glass-panel p-5">
            <p className="label-sm text-muted">
              Extracted Claim
            </p>
            <p className="headline-md mt-3 leading-tight text-high">
              Global supply chain disruption in Q3 was driven by localized port
              strikes, not systemic collapse.
            </p>

            <div className="mt-5 flex flex-wrap gap-2">
              {[
                "Economy",
                "International",
                "Logistics",
                "Trade",
              ].map((tag) => (
                <span
                  key={tag}
                  className="rounded-full bg-(--surface-container-high) px-3 py-1 text-xs text-high"
                >
                  {tag}
                </span>
              ))}
            </div>

            <div className="mt-6 rounded-2xl bg-emerald-500/10 px-4 py-3 text-sm font-medium text-emerald-300">
              Likely True
            </div>

            <div className="mt-6 rounded-2xl bg-(--surface-container-lowest) p-4">
              <div className="mx-auto grid h-28 w-28 place-items-center rounded-full bg-(--surface-container-low) ring-4 ring-(--accent)/35">
                <span className="headline-md text-high">94%</span>
              </div>
              <p className="label-sm mt-3 text-center text-muted">
                Confidence
              </p>
            </div>

            <div className="insight-panel mt-6 p-4 text-sm leading-6 text-muted">
              Analysis of 14 independent logistics reports confirms an 82%
              correlation with localized strike activity.
            </div>
          </aside>

          <main className="glass-panel relative overflow-hidden p-5">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="label-sm text-muted">
                Evidence Graph
              </h2>
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
                        : "rgba(244, 63, 94, 0.7)"
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
                      : "bg-rose-500/10 text-rose-200"
                  }`}
                  style={{ left: `${node.x}%`, top: `${node.y}%` }}
                  onMouseEnter={() => setActiveNode(node)}
                  onMouseLeave={() => setActiveNode(null)}
                >
                  {node.label}
                </button>
              ))}

              <div className="pulse-node absolute left-1/2 top-[52%] grid h-24 w-24 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-(--accent)/10 text-sm font-semibold text-high">
                Claim
              </div>

              <div
                className={`insight-panel absolute bottom-4 right-4 max-w-[320px] p-4 text-sm transition ${
                  activeNode ? "opacity-100 translate-y-0" : "pointer-events-none opacity-0 translate-y-2"
                }`}
              >
                <p className="title-sm text-high">{activeNode?.title}</p>
                <p className="label-sm mt-1 text-muted">
                  {activeNode?.source}
                </p>
                <p className="body-md mt-2 text-muted">{activeNode?.summary}</p>
              </div>
            </div>

            <p className="label-sm mt-4 text-muted">
              Graph animates based on confidence drift and source latency.
            </p>
          </main>

          <aside className="glass-panel p-4">
            <h2 className="label-sm px-2 text-muted">
              Sources & Evidence
            </h2>
            <div className="mt-4 space-y-3">
              {groupedCards.map((item) => (
                <article
                  key={item.id}
                  className="card-surface rounded-2xl p-4"
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="label-sm text-muted">
                      {item.source}
                    </p>
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

                  {item.expanded ? (
                    <p className="body-md mt-2 text-muted">{item.summary}</p>
                  ) : null}
                </article>
              ))}
            </div>
          </aside>
        </div>
      )}
    </section>
  );
}
