import { cn } from "@/lib/utils";

interface LogoProps {
  className?: string;
  size?: number;
}

export function Logo({ className, size = 28 }: LogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn(className)}
      aria-hidden
    >
      <rect
        x="0.5"
        y="0.5"
        width="31"
        height="31"
        rx="7.5"
        className="fill-primary/10 stroke-primary/40"
      />
      {/* pipeline arrow stitching three nodes */}
      <circle cx="7" cy="16" r="2.4" className="fill-primary" />
      <circle cx="16" cy="16" r="2.4" className="fill-primary" />
      <circle cx="25" cy="16" r="2.4" className="fill-primary" />
      <path
        d="M9.5 16 H13.5"
        className="stroke-primary"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <path
        d="M18.5 16 H21"
        className="stroke-primary"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <path
        d="M21 13 L23.5 16 L21 19"
        className="stroke-primary"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}
