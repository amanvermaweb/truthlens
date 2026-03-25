export default function AboutLoading() {
  return (
    <section className="mx-auto w-full max-w-240 px-4 pb-20 pt-10 sm:px-6">
      <article className="section-surface p-8 sm:p-12">
        <div className="skeleton h-3 w-16" />
        <div className="mt-4 space-y-3">
          <div className="skeleton h-10 w-4/5" />
          <div className="skeleton h-10 w-3/5" />
        </div>
        <div className="mt-6 space-y-3">
          <div className="skeleton h-5 w-full" />
          <div className="skeleton h-5 w-11/12" />
          <div className="skeleton h-5 w-10/12" />
        </div>
        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          <div className="skeleton h-32 w-full rounded-2xl" />
          <div className="skeleton h-32 w-full rounded-2xl" />
        </div>
      </article>
    </section>
  );
}
