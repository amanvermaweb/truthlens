"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

type ClaimComposerProps = {
  className?: string;
};

export function ClaimComposer({ className }: ClaimComposerProps) {
  const router = useRouter();
  const [claim, setClaim] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isDisabled = submitting || claim.trim().length < 8;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const trimmedClaim = claim.trim();
    if (!trimmedClaim) {
      setError("Please enter a claim to analyze.");
      return;
    }

    setSubmitting(true);

    try {
      const response = await fetch("/api/facts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ claim: trimmedClaim }),
      });

      const payload = (await response.json().catch(() => null)) as
        | { claimId?: string; error?: string }
        | null;

      if (!response.ok || !payload?.claimId) {
        throw new Error(payload?.error || "Failed to analyze claim.");
      }

      router.push(`/dashboard?claimId=${payload.claimId}`);
      router.refresh();
    } catch (submitError) {
      const message = submitError instanceof Error ? submitError.message : "Something went wrong.";
      setError(message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className={`hero-grid w-full p-5 sm:p-8 ${className ?? ""}`}>
      <form className="relative flex flex-col gap-4 sm:flex-row sm:items-end" onSubmit={onSubmit}>
        <div className="w-full">
          <label htmlFor="claim-input" className="sr-only">
            Paste a claim or article
          </label>
          <textarea
            id="claim-input"
            rows={4}
            value={claim}
            onChange={(event) => setClaim(event.target.value)}
            placeholder="Paste a claim or article..."
            className="hero-input min-h-37.5 w-full resize-none py-4 text-base text-high outline-none placeholder:text-muted"
          />
          {error ? <p className="mt-2 text-sm text-rose-300">{error}</p> : null}
        </div>
        <button type="submit" disabled={isDisabled} className="btn-primary h-12 min-w-36 px-6 disabled:opacity-70">
          {submitting ? "Analyzing..." : "Analyze"}
        </button>
      </form>
    </div>
  );
}
