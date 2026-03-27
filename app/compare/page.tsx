"use client";

import { ComparisonResult } from "@/lib/types";
import { type SubmitEvent, useState } from "react";

type CompareApiResponse = {
  comparison?: ComparisonResult;
  error?: string;
};

export default function ComparePage() {
  const [claim, setClaim] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ComparisonResult | null>(null);

  async function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/compare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ claim }),
      });

      const payload = (await response.json().catch(() => null)) as CompareApiResponse | null;

      if (!response.ok || !payload?.comparison) {
        throw new Error(payload?.error || "Unable to compare claim perspectives.");
      }

      setResult(payload.comparison);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Request failed.");
      setResult(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="mx-auto w-full max-w-275 px-4 pb-20 pt-10 sm:px-6">
      <p className="label-sm text-muted">Debate Tool</p>
      <h1 className="headline-md mt-2 text-high sm:text-4xl">Claim Comparison Mode</h1>
      <p className="mt-3 max-w-2xl body-md text-muted">
        Submit a claim to see the strongest arguments for and against before a balanced verdict.
      </p>

      <form className="mt-6 card-surface p-5" onSubmit={onSubmit}>
        <label htmlFor="compare-claim" className="label-sm text-muted">
          Claim
        </label>
        <textarea
          id="compare-claim"
          rows={4}
          value={claim}
          onChange={(event) => setClaim(event.target.value)}
          className="hero-input mt-2 w-full resize-none p-3 text-base text-high"
          placeholder="AI will replace all jobs"
        />

        {error ? <p className="mt-2 text-sm text-rose-300">{error}</p> : null}

        <button
          type="submit"
          disabled={loading || claim.trim().length < 8}
          className="btn-primary mt-4 h-11 px-5 text-sm disabled:opacity-70"
        >
          {loading ? "Comparing..." : "Compare Perspectives"}
        </button>
      </form>

      {result ? (
        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <article className="card-surface p-5">
            <h2 className="title-sm text-emerald-300">Arguments For</h2>
            <ul className="mt-3 space-y-2 text-sm text-muted">
              {(result.argumentsFor.length > 0 ? result.argumentsFor : ["No strong supporting arguments found."]).map(
                (item) => (
                  <li key={`for-${item}`}>- {item}</li>
                ),
              )}
            </ul>
          </article>

          <article className="card-surface p-5">
            <h2 className="title-sm text-rose-300">Arguments Against</h2>
            <ul className="mt-3 space-y-2 text-sm text-muted">
              {(result.argumentsAgainst.length > 0
                ? result.argumentsAgainst
                : ["No strong contradicting arguments found."]).map((item) => (
                <li key={`against-${item}`}>- {item}</li>
              ))}
            </ul>
          </article>

          <article className="card-surface p-5 md:col-span-2">
            <p className="label-sm text-muted">Balanced Verdict</p>
            <p className="headline-md mt-2 text-high">{result.balancedVerdict}</p>
            <p className="mt-2 body-md text-muted">{result.rationale}</p>

            <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4 text-sm text-high">
              <p>Factual Accuracy: {result.dimensions.factualAccuracy}%</p>
              <p>Source Agreement: {result.dimensions.sourceAgreement}%</p>
              <p>Recency Score: {result.dimensions.recencyScore}%</p>
              <p>Bias Risk: {result.dimensions.biasRisk}</p>
            </div>
          </article>
        </div>
      ) : null}
    </section>
  );
}
