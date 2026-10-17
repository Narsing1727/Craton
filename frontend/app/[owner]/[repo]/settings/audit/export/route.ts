import { proxyDownload } from "@/lib/proxy-download";

export async function GET(_req: Request, { params }: { params: Promise<{ owner: string; repo: string }> }) {
  const { owner, repo } = await params;
  return proxyDownload(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/audit-log?format=csv`);
}
