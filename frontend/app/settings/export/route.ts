// Download everything Craton holds about the signed-in person as JSON (Settings → Security).

import { getSessionToken } from "@/lib/session";

const BASE = process.env.CRATON_API_URL ?? "http://localhost:4000";

export async function GET() {
  const token = await getSessionToken();
  if (!token) return new Response("Sign in to export your data.", { status: 401 });
  let upstream: Response;
  try {
    upstream = await fetch(`${BASE}/v1/user/export`, { headers: { authorization: `Bearer ${token}` }, cache: "no-store" });
  } catch {
    return new Response("The Craton API isn't reachable.", { status: 503 });
  }
  if (!upstream.ok) return new Response(await upstream.text(), { status: upstream.status, headers: { "content-type": "application/json" } });
  const data = (await upstream.json()) as { profile?: { handle?: string } };
  const day = new Date().toISOString().slice(0, 10);
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="craton-${data.profile?.handle ?? "account"}-${day}.json"`,
      "cache-control": "no-store",
    },
  });
}
