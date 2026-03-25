export default function WelcomeLoading() {
  return (
    <section className="mx-auto w-full max-w-270 px-4 pb-20 pt-14 sm:px-6">
      <div className="section-surface p-8 sm:p-12">
        <div className="skeleton h-4 w-40" />
        <div className="mt-5 space-y-3">
          <div className="skeleton h-10 w-4/5" />
          <div className="skeleton h-10 w-3/5" />
        </div>
        <div className="mt-6 skeleton h-5 w-2/3" />
        <div className="mt-8 flex gap-3">
          <div className="skeleton h-11 w-44 rounded-full" />
          <div className="skeleton h-11 w-56 rounded-full" />
        </div>
      </div>

      <div className="mt-10 grid gap-4 md:grid-cols-3">
        {Array.from({ length: 3 }).map((_, idx) => (
          <article key={idx} className="card-surface p-6">
            <div className="skeleton h-6 w-36" />
            <div className="mt-3 space-y-2">
              <div className="skeleton h-4 w-full" />
              <div className="skeleton h-4 w-10/12" />
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
