// The audit package as a file: every commit, the ref log and an inclusion proof for every file at the tip. It can be
// megabytes for a repository with thousands of files, so it is a download, not part of the Storage page.

import { api } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ owner: string; repo: string }> }) {
  const { owner, repo } = await params;
  const pkg = await api.audit(owner, repo);
  if (!pkg) return new Response("The audit package isn't available: the repository was not found, or the Craton API isn't reachable.", { status: 503 });
  return new Response(JSON.stringify(pkg, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="${repo.replace(/[^A-Za-z0-9._-]/g, "_")}-audit-package.json"`,
      "cache-control": "private, no-cache",
      "x-content-type-options": "nosniff",
    },
  });
}
