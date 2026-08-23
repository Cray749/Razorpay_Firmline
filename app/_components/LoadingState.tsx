export function LoadingState({ label }: { label: string }) {
  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <div className="skeleton h-8 w-48" />
      <div className="skeleton mt-4 h-4 w-72" />
      <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="skeleton h-20" />
        <div className="skeleton h-20" />
        <div className="skeleton h-20" />
      </div>
      <p className="mt-6 text-sm text-navy-muted">{label}</p>
    </div>
  );
}
