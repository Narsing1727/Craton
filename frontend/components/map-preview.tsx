// Demo-only stand-in (CRATON_DEMO=1): seeded coloured squares, not data. Real previews are
// components/data-preview.tsx, rendered from the stored bytes by the API.
import { cn } from "@/lib/utils";

// Deterministic pseudo-random generator so previews are stable across renders.
function seeded(seed: number) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

type MapPreviewProps = {
  seed?: number;
  variant?: "terrain" | "vector";
  className?: string;
  // Cells to highlight as a diff: key `${row}-${col}` -> "added" | "removed" | "changed"
  diff?: Record<string, "added" | "removed" | "changed">;
  cols?: number;
  rows?: number;
};

const diffFill: Record<string, string> = {
  added: "var(--chart-2)",
  removed: "var(--destructive)",
  changed: "var(--chart-4)",
};

export function MapPreview({ seed = 7, variant = "terrain", className, diff, cols = 16, rows = 10 }: MapPreviewProps) {
  const rand = seeded(seed);
  const cells: React.ReactNode[] = [];
  const w = 100 / cols;
  const h = 100 / rows;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const elevation = rand();
      const key = `${r}-${c}`;
      const highlighted = diff?.[key];
      const lightness = 0.28 + elevation * 0.5;
      const fill = highlighted
        ? diffFill[highlighted]
        : `oklch(${lightness} 0.07 250)`;
      cells.push(
        <rect
          key={key}
          x={c * w}
          y={r * h}
          width={w}
          height={h}
          fill={fill}
          opacity={highlighted ? 0.92 : 1}
        />,
      );
    }
  }

  return (
    <div className={cn("relative overflow-hidden rounded-lg border border-border bg-muted/40", className)}>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="size-full" role="img" aria-label="Map data preview">
        <g>{cells}</g>
        {variant === "vector" && (
          <g fill="none" stroke="var(--chart-3)" strokeWidth="0.6" opacity="0.85">
            <path d="M4 78 C 22 60, 34 66, 46 48 S 72 30, 94 22" />
            <path d="M10 92 C 30 82, 40 70, 58 62 S 80 52, 96 44" />
            <path d="M2 40 C 20 44, 30 30, 48 30 S 70 18, 88 8" strokeDasharray="2 2" />
          </g>
        )}
      </svg>
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-background/30 to-transparent" />
    </div>
  );
}

export function MapDiffLegend() {
  return (
    <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
      <span className="flex items-center gap-1.5">
        <span className="size-3 rounded-sm" style={{ background: "var(--chart-2)" }} /> Added
      </span>
      <span className="flex items-center gap-1.5">
        <span className="size-3 rounded-sm" style={{ background: "var(--chart-4)" }} /> Changed
      </span>
      <span className="flex items-center gap-1.5">
        <span className="size-3 rounded-sm" style={{ background: "var(--destructive)" }} /> Removed
      </span>
    </div>
  );
}
