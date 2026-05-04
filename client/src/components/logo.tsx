/**
 * DeployOps wordmark + monogram.
 * Single shape — a "pipeline" arrow stitching three nodes.
 * Works at 24px and at 200px. currentColor for theme awareness.
 */
export function Monogram({ size = 28 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="DeployOps logo"
    >
      <rect x="0.5" y="0.5" width="31" height="31" rx="7.5" stroke="currentColor" strokeOpacity="0.15" />
      <circle cx="9" cy="11" r="2" fill="currentColor" />
      <circle cx="9" cy="21" r="2" fill="currentColor" />
      <path
        d="M9 11h11a4 4 0 010 8H9"
        stroke="hsl(var(--primary))"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M22 17.6l3 1.4-3 1.4" stroke="hsl(var(--primary))" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Wordmark() {
  return (
    <div className="flex items-center gap-2">
      <Monogram size={26} />
      <div className="leading-tight">
        <div className="text-sm font-semibold tracking-tight">DeployOps</div>
        <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Console</div>
      </div>
    </div>
  );
}
