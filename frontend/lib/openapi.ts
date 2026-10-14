// The API's own OpenAPI document, read for the API reference page so query parameters and request bodies are shown
// from the one place that knows them. Server only; the page still renders (with sentences only) if the API is down.

const BASE = (process.env.CRATON_API_URL ?? "http://localhost:4000").replace(/\/+$/, "");

export type OpParam = { name: string; in: string; required: boolean; description?: string };
export type OpBody = { fields: { name: string; type: string; required: boolean; description?: string }[]; example?: unknown };
export type OpDetail = { params: OpParam[]; body: OpBody | null };

type Schema = { type?: string | string[]; properties?: Record<string, Schema & { description?: string; enum?: string[] }>; required?: string[] };

/** "{owner}" and "{n}" and "{number}" are the same thing to a reader: key operations by shape. */
export const opKey = (method: string, path: string) => `${method.toLowerCase()} ${path.replace(/\{[^}]+\}/g, "{}")}`;

export async function loadOperations(): Promise<Map<string, OpDetail>> {
  const out = new Map<string, OpDetail>();
  try {
    const res = await fetch(`${BASE}/v1/openapi.json`, { next: { revalidate: 300 }, signal: AbortSignal.timeout(4000) });
    if (!res.ok) return out;
    const doc = (await res.json()) as { paths: Record<string, Record<string, { parameters?: (OpParam & { schema?: unknown })[]; requestBody?: { content?: { "application/json"?: { schema?: Schema; example?: unknown } } } }>> };
    for (const [path, ops] of Object.entries(doc.paths)) {
      for (const [method, op] of Object.entries(ops)) {
        const params = (op.parameters ?? []).filter((p) => p.in === "query").map((p) => ({ name: p.name, in: p.in, required: Boolean(p.required), description: p.description }));
        const json = op.requestBody?.content?.["application/json"];
        let body: OpBody | null = null;
        if (json?.schema?.properties) {
          const required = new Set(json.schema.required ?? []);
          body = {
            fields: Object.entries(json.schema.properties).map(([name, s]) => ({
              name,
              type: Array.isArray(s.type) ? s.type.filter((t) => t !== "null").join(" or ") + (s.type.includes("null") ? ", or null" : "") : (s.enum ? s.enum.join(" | ") : (s.type ?? "any")),
              required: required.has(name),
              description: s.description,
            })),
            example: json.example,
          };
        }
        if (params.length || body) out.set(opKey(method, path), { params, body });
      }
    }
  } catch {
    // No API: the page shows its sentences only.
  }
  return out;
}

export type EventDoc = { when: string; fields: Record<string, string>; optional?: string[] };

/** What each webhook event carries, from the API (the same table the tests compare with real deliveries). */
export async function loadWebhookEvents(): Promise<Record<string, EventDoc>> {
  try {
    const res = await fetch(`${BASE}/v1/webhook-events`, { next: { revalidate: 300 }, signal: AbortSignal.timeout(4000) });
    return res.ok ? ((await res.json()) as Record<string, EventDoc>) : {};
  } catch {
    return {};
  }
}
