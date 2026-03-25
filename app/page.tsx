import { auth } from "@clerk/nextjs/server";
import Link from "next/link";

export default async function Home() {
  const { userId } = await auth();

  return (
    <section className="mx-auto w-full max-w-305 px-4 pb-20 pt-14 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-5xl flex-col items-center text-center">
        <p className="label-sm text-muted">Ethereal Analyst Interface</p>
        <h1 className="display-lg mt-8 max-w-5xl text-high">
          Decipher the <span className="text-gradient">unseen</span> facts.
        </h1>
        <p className="mt-5 max-w-3xl text-base leading-8 text-muted sm:text-lg">
          Enter any statement, news clip, or article. Our verification engine
          cross-references millions of source nodes to deliver defensible truth.
        </p>

        <p className="mt-3 body-md text-muted">
          {userId
            ? "You are signed in. Open the dashboard to continue analysis."
            : "Sign in or sign up from the top-right navigation to continue."}
        </p>

        <div className="hero-grid mt-12 w-full p-5 sm:p-8">
          <div className="relative flex flex-col gap-4 sm:flex-row sm:items-end">
            <label htmlFor="claim-input" className="sr-only">
              Paste a claim or article
            </label>
            <textarea
              id="claim-input"
              rows={4}
              placeholder="Paste a claim or article..."
              className="hero-input min-h-37.5 w-full resize-none py-4 text-base text-high outline-none placeholder:text-muted"
            />
            <Link href="/dashboard" className="btn-primary h-12 min-w-36 px-6">
              Analyze
            </Link>
          </div>
        </div>

        <div className="mt-12 grid w-full gap-4 md:grid-cols-3">
          {[
            {
              title: "Deep Integrity",
              text: "Every source is vetted through weighted credibility and provenance analysis.",
            },
            {
              title: "Linguistic Logic",
              text: "Semantic fallacies and manipulative phrasing are flagged in real time.",
            },
            {
              title: "Universal Mapping",
              text: "Claim-to-evidence relationships are visualized in one coherent graph.",
            },
          ].map((feature) => (
            <article key={feature.title} className="card-surface p-6 text-left">
              <h2 className="title-sm text-high">{feature.title}</h2>
              <p className="body-md mt-3 text-muted">{feature.text}</p>
            </article>
          ))}

        </div>

        <article className="insight-panel mt-10 w-full max-w-3xl p-6 text-left sm:p-8">
          <p className="label-sm text-muted">Insight Panel</p>
          <p className="headline-md mt-3 text-high">
            Current model consensus indicates high confidence in source-clustered
            validation with low rhetorical contamination.
          </p>
        </article>
      </div>
    </section>
  );
}
