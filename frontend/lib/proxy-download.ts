// Pass a download from the API through with the person's session, so the browser can save it as a file.

import { getSessionToken } from "@/lib/session";

const BASE = process.env.CRATON_API_URL ?? "http://localhost:4000";

export async function proxyDownload(apiPath: string): Promise<Response> {
  const token = await getSessionToken();
  if (!token) return new Response("Sign in to download this.", { status: 401 });
  let upstream: Response;
  try {
    upstream = await fetch(`${BASE}/v1${apiPath}`, { headers: { authorization: `Bearer ${token}` }, cache: "no-store" });
  } catch {
    return new Response("The Craton API isn't reachable.", { status: 503 });
  }
  if (!upstream.ok) return new Response(await upstream.text(), { status: upstream.status, headers: { "content-type": "application/json" } });
  const headers = new Headers();
  for (const h of ["content-type", "content-disposition", "cache-control"]) {
    const v = upstream.headers.get(h);
    if (v) headers.set(h, v);
  }
  return new Response(upstream.body, { headers });
}
