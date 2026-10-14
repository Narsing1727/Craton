// The web app's own health, for a load balancer: 200 when this process can reach the API and the API says it is
// ready (database and chunk store usable), 503 otherwise, with how long the API took. No sign-in needed; nothing
// private is returned.

const BASE = (process.env.CRATON_API_URL ?? "http://localhost:4000").replace(/\/+$/, "");

export const dynamic = "force-dynamic";

export async function GET() {
  const started = Date.now();
  let api: { reachable: boolean; ready: boolean; status: number | null; ms: number; error?: string };
  try {
    const res = await fetch(`${BASE}/v1/ready`, { cache: "no-store", signal: AbortSignal.timeout(3000) });
    const body = (await res.json().catch(() => null)) as { ready?: boolean } | null;
    api = { reachable: true, ready: res.ok && body?.ready === true, status: res.status, ms: Date.now() - started };
  } catch (err) {
    api = { reachable: false, ready: false, status: null, ms: Date.now() - started, error: err instanceof Error ? err.message : String(err) };
  }
  return Response.json({ ok: api.ready, web: "ok", api }, { status: api.ready ? 200 : 503, headers: { "cache-control": "no-store" } });
}
