export function DashboardLoadingState() {
  return (
    <div className="grid gap-4 lg:grid-cols-[280px_1fr_320px]">
      <div className="glass-panel p-5">
        <div className="skeleton h-4 w-24" />
        <div className="mt-4 space-y-3">
          <div className="skeleton h-4 w-full" />
          <div className="skeleton h-4 w-10/12" />
          <div className="skeleton h-4 w-9/12" />
        </div>
        <div className="mt-6 skeleton h-28 w-full rounded-2xl" />
      </div>

      <div className="glass-panel p-5">
        <div className="skeleton h-5 w-48" />
        <div className="mt-6 skeleton h-130 w-full rounded-3xl" />
      </div>

      <div className="glass-panel p-5">
        <div className="skeleton h-5 w-36" />
        <div className="mt-5 space-y-3">
          <div className="skeleton h-24 w-full rounded-2xl" />
          <div className="skeleton h-24 w-full rounded-2xl" />
          <div className="skeleton h-24 w-full rounded-2xl" />
        </div>
      </div>
    </div>
  );
}
