export default function AboutPage() {
  return (
    <section className="mx-auto w-full max-w-240 px-4 pb-20 pt-10 sm:px-6">
      <article className="section-surface p-8 sm:p-12">
        <p className="label-sm text-muted">About</p>
        <h1 className="display-lg mt-3 text-high">
          Trustworthy decisions start with transparent evidence.
        </h1>
        <p className="mt-6 max-w-2xl text-base leading-7 text-muted">
          TruthLens helps analysts evaluate claims through a graph-based evidence
          model. We combine source credibility scoring, semantic consistency
          checks, and contradiction detection to provide concise, explainable
          verdicts.
        </p>
        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          <div className="card-surface p-5">
            <h2 className="title-sm text-high">Methodology</h2>
            <p className="body-md mt-2 text-muted">
              Weighted source ranking, linguistic anomaly detection, and
              temporal consistency checks.
            </p>
          </div>
          <div className="card-surface p-5">
            <h2 className="title-sm text-high">Audience</h2>
            <p className="body-md mt-2 text-muted">
              Policy researchers, investigative journalists, and market analysts
              requiring high-confidence verification.
            </p>
          </div>
        </div>
      </article>
    </section>
  );
}
