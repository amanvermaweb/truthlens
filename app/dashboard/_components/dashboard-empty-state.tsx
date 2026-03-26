import Link from "next/link";

type DashboardEmptyStateProps = {
  error: string | null;
};

export function DashboardEmptyState({ error }: DashboardEmptyStateProps) {
  return (
    <section className="mx-auto w-full max-w-240 px-4 pb-16 pt-8 sm:px-6 lg:px-8">
      <article className="glass-panel p-8 sm:p-10">
        <p className="label-sm text-muted">Analysis Engine</p>
        <h1 className="headline-md mt-3 text-high">No verification available yet</h1>
        <p className="body-md mt-3 text-muted">
          Submit a claim from the home page to generate a fact-check report.
        </p>
        {error ? <p className="mt-2 text-sm text-rose-300">{error}</p> : null}
        <Link href="/" className="btn-primary mt-6 h-11 px-5 text-sm">
          Start Verification
        </Link>
      </article>
    </section>
  );
}
