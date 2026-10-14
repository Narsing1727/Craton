import { cn } from "cn";

// A square outline, not a circle: loading states are structure, which stays square in the
// 90/10 radius system (app/globals.css), unlike the curved spinners most UI kits ship.
export function SquareSpinner({
  size = 20,
  className,
  ...props
}: { size?: number } & React.ComponentProps<"svg">) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      role="status"
      aria-label="Loading"
      className={cn(
        "text-muted-foreground motion-safe:[animation:var(--animate-spin-around)] motion-reduce:opacity-60",
        className,
      )}
      {...props}
    >
      <rect
        x="2.5"
        y="2.5"
        width="19"
        height="19"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="square"
        pathLength={100}
        strokeDasharray="28 72"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
