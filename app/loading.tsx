export default function AppLoading() {
  return (
    <section className="mx-auto w-full max-w-305 px-4 pb-20 pt-14 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-4xl">
        <div className="section-surface p-8 sm:p-10">
          <div className="skeleton h-4 w-44" />
          <div className="mt-6 space-y-3">
            <div className="skeleton h-11 w-4/5" />
            <div className="skeleton h-11 w-3/5" />
          </div>
          <div className="mt-5 skeleton h-6 w-3/4" />
          <div className="mt-10 skeleton h-44 w-full rounded-3xl" />
        </div>
      </div>
    </section>
  );
}
