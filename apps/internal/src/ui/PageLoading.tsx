export function PageLoading({ label = "لحظات…" }: { label?: string }) {
  return (
    <div className="page-loading" role="status">
      {label}
    </div>
  );
}
