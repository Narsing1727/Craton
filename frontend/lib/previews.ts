// Previews for a list of changed files (a commit, a comparison, a pull request). Server only.
// Rasters and shapefiles get the change drawn from base to head; a change that only touched a
// shapefile's attribute table (.dbf) is shown on its .shp, since that's where features are drawn.

import { api, previewable, renderMeta, type ApiRasterStats, type ApiTextDiff, type RenderMeta } from "@/lib/api";
import { previewSrc } from "@/components/data-preview";

export type FilePreview = { path: string; src: string; meta: RenderMeta | null; error: string | null; isDiff: boolean; stats?: ApiRasterStats | null; text?: ApiTextDiff | null };

/** Files that are plain text by their name: model inputs, configs, notes. The server still checks the bytes. */
const TEXT_FILE = /\.(txt|md|json|ya?ml|toml|ini|cfg|inp|net|prj|rasmap|bat|sh|py|r|[pgufh]\d\d|x\d\d|c\d\d|b\d\d|o\d\d)$/i;

export async function changePreviews(
  owner: string,
  repo: string,
  head: string,
  base: string | undefined,
  files: { name: string; change?: "added" | "removed" | "modified" }[],
): Promise<Record<string, FilePreview>> {
  const names = new Set(files.map((f) => f.name));
  const out: Record<string, FilePreview> = {};
  await Promise.all(
    files.map(async (f) => {
      if (f.change === "removed") return;
      // A changed text file gets a line diff instead of a map.
      if (f.change === "modified" && base && TEXT_FILE.test(f.name)) {
        const diff = await api.textDiff(owner, repo, head, f.name, base).catch(() => null);
        if (diff) out[f.name] = { path: f.name, src: "", meta: null, error: null, isDiff: true, text: diff };
        return;
      }
      const viaDbf = /\.dbf$/i.test(f.name);
      const path = viaDbf ? f.name.replace(/\.dbf$/i, ".shp") : f.name;
      if (!previewable(path) || (viaDbf && names.has(path))) return;
      const diffBase = base && (f.change === "modified" || viaDbf) ? base : undefined;
      const r = await renderMeta(owner, repo, head, path, { base: diffBase });
      if (viaDbf && r.error) return; // no shapefile beside this table
      // Numbers beside the heatmap: only for a GeoTIFF that changed and drew without error.
      const stats = diffBase && !r.error && /\.tiff?$/i.test(path) ? await api.rasterStats(owner, repo, head, path, diffBase) : null;
      out[f.name] = { path, src: previewSrc(owner, repo, head, path, { base: diffBase }), meta: r.meta, error: r.error, isDiff: !!diffBase, stats };
    }),
  );
  return out;
}
