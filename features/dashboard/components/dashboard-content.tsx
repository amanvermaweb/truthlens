"use client";

import { ClaimPayload } from "@/lib/types";
import { ClaimSidebar } from "./claim-sidebar";
import { EvidenceGraphPanel } from "./evidence-graph-panel";
import { SourcesEvidencePanel } from "./sources-evidence-panel";

type DashboardContentProps = {
  claimData: ClaimPayload;
  error: string | null;
};

export function DashboardContent({ claimData, error }: DashboardContentProps) {
  return (
    <div className="grid gap-4 lg:grid-cols-[280px_1fr_320px]">
      <ClaimSidebar claimData={claimData} />
      <EvidenceGraphPanel claimData={claimData} error={error} />
      <SourcesEvidencePanel claimData={claimData} />
    </div>
  );
}
