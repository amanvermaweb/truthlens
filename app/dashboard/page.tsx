"use client";

import { DashboardContent } from "@/app/dashboard/_components/dashboard-content";
import { DashboardEmptyState } from "@/app/dashboard/_components/dashboard-empty-state";
import { DashboardLoadingState } from "@/app/dashboard/_components/dashboard-loading-state";
import { ClaimPayload } from "@/lib/types";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

export default function DashboardPage() {
  const searchParams = useSearchParams();
  const claimId = searchParams.get("claimId");

  const [loading, setLoading] = useState(true);
  const [claimData, setClaimData] = useState<ClaimPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchClaim = async () => {
      try {
        setLoading(true);
        setError(null);

        const url = claimId ? `/api/facts?claimId=${claimId}` : "/api/facts";
        const response = await fetch(url, { cache: "no-store" });
        const payload = (await response.json().catch(() => null)) as
          | { claim?: ClaimPayload | null; error?: string }
          | null;

        if (!response.ok) {
          throw new Error(payload?.error || "Failed to fetch claim data");
        }

        setClaimData(payload?.claim ?? null);
      } catch (error) {
        setError(error instanceof Error ? error.message : "Unable to load data");
        setClaimData(null);
      } finally {
        setLoading(false);
      }
    };

    fetchClaim();
  }, [claimId]);

  if (!loading && !claimData) {
    return <DashboardEmptyState error={error} />;
  }

  return (
    <section className="mx-auto w-full max-w-350 px-4 pb-16 pt-8 sm:px-6 lg:px-8">
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <p className="label-sm text-muted">Analysis Engine</p>
          <h1 className="headline-md mt-2 text-high">
            Evidence Connectivity Dashboard
          </h1>
        </div>
        <Link href="/" className="btn-primary h-11 px-5 text-sm">
          New Verification
        </Link>
      </div>

      {loading ? (
        <DashboardLoadingState />
      ) : (
        claimData && <DashboardContent claimData={claimData} error={error} />
      )}
    </section>
  );
}
