export default function DashboardLoading() {
  return (
    <section className="mx-auto w-full max-w-350 px-4 pb-16 pt-8 sm:px-6 lg:px-8">
      <div className="mb-6 space-y-3">
        <div className="skeleton h-3 w-36" />
        <div className="skeleton h-9 w-105" />
      </div>

      <div className="grid gap-4 lg:grid-cols-[280px_1fr_320px]">
        <div className="section-surface p-5">
          <div className="skeleton h-4 w-24" />
          <div className="mt-4 space-y-3">
            <div className="skeleton h-4 w-full" />
            <div className="skeleton h-4 w-10/12" />
            <div className="skeleton h-4 w-9/12" />
          </div>
          <div className="mt-6 skeleton h-28 w-full rounded-2xl" />
          <div className="mt-4 skeleton h-32 w-full rounded-2xl" />
        </div>

        <div className="section-surface p-5">
          <div className="skeleton h-5 w-48" />
          <div className="mt-6 skeleton h-140 w-full rounded-3xl" />
        </div>

        <div className="section-surface p-4">
          <div className="skeleton h-4 w-40" />
          <div className="mt-4 space-y-3">
            <div className="skeleton h-24 w-full rounded-2xl" />
            <div className="skeleton h-24 w-full rounded-2xl" />
            <div className="skeleton h-24 w-full rounded-2xl" />
          </div>
        </div>
      </div>
    </section>
  );
}
