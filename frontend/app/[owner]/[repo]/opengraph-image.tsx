// The picture a pasted link to a public repository previews as: its name, description and what is in it. A
// private or missing repository gets a plain Craton card that says nothing about it (a link must not confirm
// that a private repository exists).

import { ImageResponse } from "next/og";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "A repository on Craton";
export const dynamic = "force-dynamic";

export default async function Image({ params }: { params: Promise<{ owner: string; repo: string }> }) {
  const { owner, repo } = await params;
  // No token: what an anonymous crawler could see.
  const res = await fetch(`${(process.env.CRATON_API_URL ?? "http://localhost:4000").replace(/\/+$/, "")}/v1/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`, { cache: "no-store" }).catch(() => null);
  const info = res?.ok ? ((await res.json()) as { visibility?: string; description?: string; tags?: string[]; sizeBytes?: number; license?: string; commitCount?: number; stars?: number }) : null;
  const isPublic = info?.visibility === "public";
  const mb = info?.sizeBytes ? (info.sizeBytes >= 1e9 ? `${(info.sizeBytes / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(info.sizeBytes / 1e6))} MB`) : null;
  const facts = isPublic ? [...(info?.tags ?? []).slice(0, 3), mb, info?.license || null].filter(Boolean) : [];
  return new ImageResponse(
    (
      <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", width: "100%", height: "100%", padding: 72, background: "#0a0a0a", color: "#fafafa" }}>
        <div style={{ display: "flex", fontSize: 30, color: "#a3a3a3" }}>Craton</div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", fontSize: isPublic ? 76 : 64, fontWeight: 700, lineHeight: 1.1, wordBreak: "break-all" }}>{isPublic ? `${owner}/${repo}` : "Version control for hydro and GIS data"}</div>
          {isPublic && info?.description ? <div style={{ display: "flex", marginTop: 28, fontSize: 34, color: "#d4d4d4", lineHeight: 1.3 }}>{info.description.slice(0, 160)}</div> : null}
        </div>
        <div style={{ display: "flex", gap: 24, fontSize: 28, color: "#a3a3a3" }}>
          {facts.map((f) => (
            <div key={String(f)} style={{ display: "flex", border: "1px solid #404040", padding: "8px 18px" }}>{String(f)}</div>
          ))}
        </div>
      </div>
    ),
    { ...size },
  );
}
