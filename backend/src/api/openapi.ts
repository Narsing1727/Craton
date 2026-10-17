// An OpenAPI 3.1 description generated from the routes the server actually has, so it can't drift from the code.
// It lists every path and method, the path parameters, the bearer scheme and the one error shape every route uses.
// Response schemas for the endpoints people script against first are written by hand in openapi-schemas.ts and
// checked against real responses in the tests; everything else is described by path, method and parameters only.
// Request bodies are documented by hand on the website's API reference.

export type RouteInfo = { method: string; path: string };

import { created as knownCreated, queries as knownQueries, requests as knownRequests, responses as knownResponses, schemas } from "./openapi-schemas.ts";

const METHODS = ["get", "post", "put", "patch", "delete"] as const;

/** "/repos/:owner/:repo/raw/:ref/:path{.+}" -> "/repos/{owner}/{repo}/raw/{ref}/{path}" */
export function openApiPath(honoPath: string): string {
  return honoPath.replace(/:([A-Za-z_][A-Za-z0-9_]*)(\{[^}]*\})?/g, "{$1}");
}

function pathParams(path: string): string[] {
  return [...path.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]);
}

/** A stable, readable tag: the collection a route belongs to ("repos", or what follows owner/repo). */
export function tagOf(path: string): string {
  const parts = path.split("/").filter(Boolean);
  if (parts[0] === "repos" && parts.length > 3) return parts[3].replace(/[{}]/g, "");
  if (parts[0] === "repos") return "repos";
  return parts[0] ?? "root";
}

function operationId(method: string, path: string): string {
  const words = path.split("/").filter(Boolean).map((p) => p.replace(/[{}]/g, "").replace(/[^A-Za-z0-9]+(.)?/g, (_m, c: string) => (c ?? "").toUpperCase()));
  return method + words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join("");
}

export function buildOpenApi(routes: RouteInfo[], opts: { version: string; server?: string }) {
  const paths: Record<string, Record<string, unknown>> = {};
  const seen = new Set<string>();
  for (const r of routes) {
    const method = r.method.toLowerCase();
    if (!(METHODS as readonly string[]).includes(method)) continue; // middleware shows up as ALL
    const path = openApiPath(r.path);
    const key = `${method} ${path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const params: Record<string, unknown>[] = pathParams(path).map((name) => ({ name, in: "path", required: true, schema: { type: "string" } }));
    for (const q of knownQueries[key] ?? []) params.push({ name: q.name, in: "query", required: Boolean(q.required), description: q.description, schema: q.schema });
    (paths[path] ??= {})[method] = {
      operationId: operationId(method, path),
      tags: [tagOf(path)],
      summary: `${method.toUpperCase()} ${path}`,
      ...(params.length ? { parameters: params } : {}),
      ...(knownRequests[key] ? { requestBody: { required: true, content: { "application/json": { schema: knownRequests[key].schema, example: knownRequests[key].example } } } } : {}),
      // Public repositories can be read without a token; everything else needs one.
      security: [{ bearer: [] }, {}],
      responses: {
        [knownCreated[key]?.status ?? "200"]: knownCreated[key]
          ? { description: knownCreated[key].status === "201" ? "Created" : "Success", content: { "application/json": { schema: knownCreated[key].schema } } }
          : knownResponses[key]
            ? { description: "Success", content: { "application/json": { schema: knownResponses[key] } } }
            : { description: "Success" },
        default: { description: "Error", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
      },
    };
  }
  const sorted = Object.fromEntries(Object.entries(paths).sort(([a], [b]) => (a < b ? -1 : 1)));
  return {
    openapi: "3.1.0",
    info: {
      title: "Craton API",
      version: opts.version,
      description: "Version control for geospatial and hydrology files. Paths come from the server's routes; response schemas exist for the most used endpoints and are tested against real responses; request bodies are documented in the API reference.",
    },
    servers: [{ url: `${opts.server ?? ""}/v1` }],
    paths: sorted,
    components: {
      securitySchemes: { bearer: { type: "http", scheme: "bearer", description: "A personal access token or a session token." } },
      schemas: {
        ...schemas,
        Error: {
          type: "object",
          required: ["error"],
          properties: { error: { type: "object", required: ["code", "message"], properties: { code: { type: "string" }, message: { type: "string" }, details: {} } } },
        },
      },
    },
  };
}
