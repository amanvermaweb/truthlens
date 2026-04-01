import Link from "next/link";

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
      </article>
        <p className="mt-6 text-base text-center leading-7 text-muted">
          Made with ❤️ by <Link href="https://github.com/amanvermaweb/" className="underline">Aman Verma</Link>
        </p>
    </section>
  );
}
