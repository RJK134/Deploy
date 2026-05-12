export default function Loading() {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Loading"
      className="fixed left-0 right-0 top-0 z-50 h-0.5 overflow-hidden bg-transparent"
    >
      <div className="h-full w-1/3 animate-pulse bg-primary" />
    </div>
  );
}
