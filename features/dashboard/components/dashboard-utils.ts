import { ClaimPayload, SourceNode } from "@/lib/types";

export function reliabilityTone(score: number) {
  if (score >= 80) {
    return "text-emerald-300 bg-emerald-500/10";
  }

  if (score >= 60) {
    return "text-amber-300 bg-amber-500/10";
  }

  return "text-rose-300 bg-rose-500/10";
}

export function verdictTone(verdict: ClaimPayload["verdict"]) {
  if (verdict === "True") {
    return "bg-emerald-500/10 text-emerald-300";
  }

  if (verdict === "False") {
    return "bg-rose-500/10 text-rose-300";
  }

  if (verdict === "Unknown") {
    return "bg-slate-500/20 text-slate-200";
  }

  return "bg-amber-500/10 text-amber-300";
}

export function sortByCredibility(nodes: SourceNode[]) {
  return nodes.slice().sort((a, b) => b.credibility - a.credibility);
}
