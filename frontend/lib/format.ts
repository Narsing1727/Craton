// Shared display formatting for data coming from the Craton API.

export function formatBytes(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

/**
 * How a stored chunk is kept, in words. Every form is exact: the bytes anyone downloads are the bytes that were uploaded
 * (the server checks this before it keeps any of them), so the labels say what was done, never that something was lost.
 */
export function codecLabel(codec: string): string {
  if (codec === "none") return "kept as uploaded";
  if (codec === "zstd") return "compressed, exact";
  if (codec === "tiles") return "old version kept as pixels, exact";
  if (codec === "ref-delta") return "kept as the difference from an earlier version, exact";
  if (codec === "records+zstd") return "point records regrouped and compressed, exact";
  if (/shuffle/.test(codec)) return codec.includes("delta") ? "numbers regrouped, differenced and compressed, exact" : "numbers regrouped and compressed, exact";
  return `${codec}, exact`;
}

export function codecLabels(codecs: string[]): string {
  return [...new Set(codecs.map(codecLabel))].join(" · ");
}

export function timeAgo(iso: string, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  const units: [number, string][] = [
    [60 * 60 * 24 * 365, "year"],
    [60 * 60 * 24 * 30, "month"],
    [60 * 60 * 24 * 7, "week"],
    [60 * 60 * 24, "day"],
    [60 * 60, "hour"],
    [60, "minute"],
  ];
  for (const [size, name] of units) {
    const n = Math.floor(seconds / size);
    if (n >= 1) return `${n} ${name}${n === 1 ? "" : "s"} ago`;
  }
  return "just now";
}

export function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(iso));
}
