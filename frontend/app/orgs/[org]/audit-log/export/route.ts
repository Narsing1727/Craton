import { proxyDownload } from "@/lib/proxy-download";

export async function GET(_req: Request, { params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  return proxyDownload(`/orgs/${encodeURIComponent(org)}/audit-log?format=csv`);
}
