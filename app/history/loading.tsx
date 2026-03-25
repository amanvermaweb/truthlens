export default function HistoryLoading() {
  return (
    <section className="mx-auto w-full max-w-275 px-4 pb-20 pt-10 sm:px-6">
      <div className="space-y-3">
        <div className="skeleton h-10 w-72" />
        <div className="skeleton h-5 w-96" />
      </div>

      <div className="mt-8 grid gap-4">
        {Array.from({ length: 3 }).map((_, idx) => (
          <article key={idx} className="card-surface p-5">
            <div className="skeleton h-3 w-24" />
            <div className="mt-3 skeleton h-6 w-4/5" />
            <div className="mt-4 skeleton h-5 w-56" />
          </article>
        ))}
      </div>
    </section>
  );
}
