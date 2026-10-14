import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CodeView, type CodeViewPreview } from "./code-view";
import type { FileTreeItem } from "@/components/file-tree";
import { folderTree, type FileNode } from "@/lib/data";
import { loadBranches, loadCommit, loadFile, loadLocks, loadRepo, loadTree } from "@/lib/source";
import { LockBadge } from "@/components/lock-badge";
import { api, PUBLIC_API_URL, renderMeta } from "@/lib/api";
import { EmptyRepo } from "@/components/empty-repo";
import { previewCaption, previewSrc } from "@/components/data-preview";
import { getUnits } from "@/lib/units-server";

type Params = { owner: string; repo: string };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { owner, repo } = await params;
  const { repo: data } = await loadRepo(owner, repo);
  const description = data.description?.trim() || `${[...(data.tags ?? []), "data"].join(", ")} versioned on Craton.`;
  // The preview image beside this (opengraph-image.tsx) is drawn only for public repositories.
  return {
    title: `${owner}/${repo}`,
    description,
    openGraph: { type: "website", siteName: "Craton", title: `${owner}/${repo}`, description },
    twitter: { card: "summary_large_image", title: `${owner}/${repo}`, description },
  };
}

type Node = FileNode & { children?: Node[] };

function toItems(nodes: Node[], base: string, ref: string, query: string, locks: Record<string, string>): FileTreeItem[] {
  return nodes.map((n) => {
    const path = n.path ?? n.name;
    return {
      id: path,
      name: n.name,
      type: n.type === "dir" ? "folder" : "file",
      size: n.size,
      lastCommit: n.lastCommit,
      updated: n.updated,
      dataType: n.dataType,
      href: n.type === "dir" ? `${base}/tree/${encodeURIComponent(ref)}/${path}` : `${base}/blob/${path}${query}`,
      badge: n.type !== "dir" && locks[path] ? <LockBadge holder={locks[path]} /> : undefined,
      children: n.children ? toItems(n.children, base, ref, query, locks) : undefined,
    };
  });
}

/** Demo tree (API not running): lib/data.ts folders, nested. */
function demoNodes(dir = ""): Node[] {
  return (folderTree[dir] ?? []).map((n) => {
    const path = dir ? `${dir}/${n.name}` : n.name;
    return { ...n, path, children: n.type === "dir" ? demoNodes(path) : undefined };
  });
}

/** Shallowest GeoTIFF (breadth-first), so the main DEM wins over tiles in subfolders. */
function firstRaster(nodes: Node[]): Node | undefined {
  let level = nodes;
  while (level.length) {
    const hit = level.find((n) => n.type === "raster" && /\.tiff?$/i.test(n.name));
    if (hit) return hit;
    level = level.flatMap((n) => n.children ?? []);
  }
}

export default async function RepoPage({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Promise<{ ref?: string }>;
}) {
  const { owner, repo } = await params;
  const summary = await loadRepo(owner, repo);
  const ref = (await searchParams).ref || summary.repo.defaultBranch;
  const units = await getUnits();
  const base = `/${owner}/${repo}`;
  const query = ref === summary.repo.defaultBranch ? "" : `?ref=${encodeURIComponent(ref)}`;

  const [{ branches }, tree, locks, releases] = await Promise.all([loadBranches(owner, repo), loadTree(owner, repo, ref), loadLocks(owner, repo), summary.live ? api.releases(owner, repo) : Promise.resolve(null)]);
  // No branches at all means a repository nobody has added to yet: show how to start, not a 404.
  if (summary.live && !tree && branches.length === 0) return <EmptyRepo owner={owner} repo={repo} defaultBranch={summary.repo.defaultBranch} apiUrl={PUBLIC_API_URL} />;
  if (summary.live && !tree) notFound(); // unknown branch or commit
  const nodes: Node[] = tree ?? demoNodes();

  // Head commit for the selected branch or commit.
  let head: { author: string; message: string; sha: string; updated: string } | null = null;
  const branch = branches.find((b) => b.name === ref);
  if (branch) head = { author: branch.author, message: branch.lastCommit, sha: branch.sha ?? "a1b2c3d", updated: branch.updated };
  else {
    const c = await loadCommit(owner, repo, ref);
    if (c) head = { author: c.commit.authorHandle, message: c.commit.message, sha: c.commit.sha, updated: c.commit.timestamp };
  }

  // Sidebar preview: the first GeoTIFF, rendered from its bytes when the API is up.
  const raster = firstRaster(nodes);
  let preview: CodeViewPreview | null = null;
  if (raster) {
    const path = raster.path ?? raster.name;
    if (summary.live) {
      const [info, rendered] = await Promise.all([loadFile(owner, repo, ref, path), renderMeta(owner, repo, ref, path, { size: 384 })]);
      const scale = info?.raster?.pixelScale;
      const caption = [scale ? `${scale[0]} m cells` : null, previewCaption(rendered.meta, units)?.split(" · ")[0]].filter(Boolean).join(" · ");
      preview = { path, caption, src: previewSrc(owner, repo, ref, path, { size: 384 }), error: rendered.error };
    } else preview = { path, caption: "2 m resolution", src: null, error: null };
  }

  // Open the folder that holds the preview so the tree starts on real data.
  const firstDir = preview?.path.includes("/") ? [preview.path.split("/")[0]] : [];

  return (
    <CodeView
      owner={owner}
      repo={repo}
      data={summary.repo}
      branches={branches.map((b) => ({ name: b.name, isDefault: b.isDefault }))}
      currentRef={ref}
      head={head}
      items={toItems(nodes, base, ref, query, locks)}
      initialExpanded={firstDir}
      readme={summary.readme}
      commitCount={summary.commitCount}
      crs={summary.crs}
      preview={preview}
      hasRelease={(releases?.length ?? 0) > 0}
    />
  );
}
