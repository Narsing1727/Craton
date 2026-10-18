// The OpenAPI document is built from the server's real routes.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/api/app.ts";
import { openDb } from "../src/db/db.ts";
import { MemoryStore } from "../src/storage/chunk-store.ts";
import { openApiPath, tagOf } from "../src/api/openapi.ts";

test("route patterns become OpenAPI paths and tags", () => {
  assert.equal(openApiPath("/repos/:owner/:repo/raw/:ref/:path{.+}"), "/repos/{owner}/{repo}/raw/{ref}/{path}");
  assert.equal(openApiPath("/repos/:owner/:repo/tree/:ref{[^/]+}"), "/repos/{owner}/{repo}/tree/{ref}");
  assert.equal(tagOf("/repos/{owner}/{repo}/pulls/{id}"), "pulls");
  assert.equal(tagOf("/repos"), "repos");
  assert.equal(tagOf("/user/tokens"), "user");
});

test("the served document lists real routes with their parameters, without needing a token", async () => {
  const app = await createApp({ db: await openDb(":memory:"), store: new MemoryStore() });
  const res = await app.request("/v1/openapi.json");
  assert.equal(res.status, 200);
  const doc = (await res.json()) as any;
  assert.equal(doc.openapi, "3.1.0");
  assert.ok(Object.keys(doc.paths).length > 100, `${Object.keys(doc.paths).length} paths`);
  const raw = doc.paths["/repos/{owner}/{repo}/raw/{ref}/{path}"].get;
  assert.deepEqual(raw.parameters.map((p: any) => p.name), ["owner", "repo", "ref", "path"]);
  assert.ok(doc.paths["/repos/{owner}/{repo}/pulls"].get);
  assert.ok(doc.paths["/health"].get);
  assert.equal(doc.paths["/health"].get.operationId, "getHealth");
  assert.ok(doc.components.schemas.Error);
  // Every operation has a unique id.
  const ids: string[] = Object.values(doc.paths).flatMap((p: any) => Object.values(p).map((o: any) => o.operationId));
  assert.equal(new Set(ids).size, ids.length, "operation ids are unique");
  assert.ok(!JSON.stringify(doc).includes("{.+}"), "no raw Hono patterns leak into the document");
});

// ── The documented response schemas are checked against real responses ──

type S = Record<string, any>;

/** A small JSON Schema subset: type (or list of types), enum, required, properties, items, allOf, $ref. */
function violations(value: unknown, schema: S, components: Record<string, S>, at = "$"): string[] {
  if (schema.$ref) return violations(value, components[String(schema.$ref).split("/").pop()!], components, at);
  if (schema.allOf) return (schema.allOf as S[]).flatMap((s) => violations(value, s, components, at));
  const out: string[] = [];
  const kind = (v: unknown) => (v === null ? "null" : Array.isArray(v) ? "array" : Number.isInteger(v) ? "integer" : typeof v);
  if (schema.type) {
    const allowed: string[] = Array.isArray(schema.type) ? schema.type : [schema.type];
    const got = kind(value);
    const ok = allowed.includes(got) || (got === "integer" && allowed.includes("number"));
    if (!ok) return [`${at}: expected ${allowed.join("|")}, got ${got}`];
  }
  if (schema.enum && !schema.enum.includes(value)) out.push(`${at}: ${JSON.stringify(value)} is not one of ${schema.enum.join(", ")}`);
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const key of (schema.required as string[]) ?? []) if (!(key in (value as S))) out.push(`${at}: missing ${key}`);
    for (const [key, sub] of Object.entries((schema.properties as S) ?? {})) if (key in (value as S)) out.push(...violations((value as S)[key], sub, components, `${at}.${key}`));
  }
  if (Array.isArray(value) && schema.items) value.slice(0, 5).forEach((v, i) => out.push(...violations(v, schema.items, components, `${at}[${i}]`)));
  return out;
}

test("every documented response schema matches what the server really returns", async () => {
  const app = await createApp({ db: await openDb(":memory:"), store: new MemoryStore() });
  const signup = await app.request("/v1/auth/signup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "rhea", email: "rhea@example.org", password: "a-very-long-password" }) });
  const token = ((await signup.json()) as { token: string }).token;
  const auth = { authorization: `Bearer ${token}` };
  await app.request("/v1/repos", { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ name: "basin", visibility: "private", sample: true }) });
  await app.request("/v1/repos/rhea/basin/releases", { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ tag: "v1.0.0", title: "First", notes: "n" }) });
  // Something in every list, so the schemas are checked against real items and not just empty arrays.
  const json = { ...auth, "content-type": "application/json" };
  await app.request("/v1/repos/rhea/basin/issues", { method: "POST", headers: json, body: JSON.stringify({ title: "Datum", body: "b", label: "bug" }) });
  await app.request("/v1/repos/rhea/basin/locks", { method: "POST", headers: json, body: JSON.stringify({ path: "terrain/basin_dem.tif", reason: "re-tiling" }) });
  await app.request("/v1/user/tokens", { method: "POST", headers: json, body: JSON.stringify({ note: "ci", scopes: ["repo"], expiresInDays: 7 }) });

  const doc = (await (await app.request("/v1/openapi.json")).json()) as { paths: S; components: { schemas: Record<string, S> } };
  const fill = (path: string) =>
    path
      .replace("{owner}", "rhea").replace("{repo}", "basin").replace("{spec}", "main...sample-resurvey")
      .replace("{ref}", "sample-resurvey").replace("{path}", "terrain/basin_dem.tif");
  const documented = Object.entries(doc.paths).flatMap(([path, ops]) =>
    Object.entries(ops as S).filter(([method, op]) => method === "get" && op.responses?.["200"]?.content).map(([method, op]) => ({ method, path, schema: op.responses["200"].content["application/json"].schema as S })),
  );
  assert.ok(documented.length >= 10, `${documented.length} operations have a schema`);
  for (const { method, path, schema } of documented) {
    const url = fill(path) + (path.includes("raster-stats") ? "?base=main" : "");
    const res = await app.request(`/v1${url}`, { method: method.toUpperCase(), headers: auth });
    assert.equal(res.status, 200, `${method} ${url} -> ${res.status}`);
    const problems = violations(await res.json(), schema, doc.components.schemas);
    assert.deepEqual(problems, [], `${method} ${path}: ${problems.slice(0, 3).join("; ")}`);
  }
});

test("every documented request example is accepted by the real endpoint, and its schema's required fields are in it", async () => {
  const { requests } = await import("../src/api/openapi-schemas.ts");
  const app = await createApp({ db: await openDb(":memory:"), store: new MemoryStore() });
  const signup = await app.request("/v1/auth/signup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "rhea", email: "rhea@example.org", password: "a-very-long-password" }) });
  const token = ((await signup.json()) as { token: string }).token;
  const send = (method: string, path: string, body?: unknown) =>
    app.request(`/v1${path}`, { method, headers: { authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
  await send("POST", "/repos", { name: "basin", visibility: "private", sample: true });

  const doc = (await (await app.request("/v1/openapi.json")).json()) as { paths: Record<string, Record<string, S>> };
  let n = 0;
  let checkedResults = 0;
  for (const [key, { schema, example }] of Object.entries(requests)) {
    const [method, path] = key.split(" ");
    assert.ok(doc.paths[path]?.[method]?.requestBody, `${key} is in the document`);
    for (const field of (schema as S).required as string[]) assert.ok(field in example, `${key}: example has ${field}`);
    const url = path.replace("{owner}", "rhea").replace("{repo}", "basin").replace("{n}", "1");
    // The /repos example would clash with the sample repository's name; every other one is sent as written.
    const res = await send(method.toUpperCase(), url, example);
    const text = await res.text();
    // What came back matches the documented result, when the request really created something.
    const documentedResult = (doc.paths[path]?.[method]?.responses as S | undefined)?.[String(res.status)]?.content?.["application/json"]?.schema as S | undefined;
    if (documentedResult && (res.status === 200 || res.status === 201)) {
      const problems = violations(JSON.parse(text), documentedResult, (doc as unknown as { components: { schemas: Record<string, S> } }).components.schemas);
      assert.deepEqual(problems, [], `${key} result: ${problems.slice(0, 3).join("; ")}`);
      checkedResults++;
    }
    // The sample project already has an open pull request from the example's branch: the request was understood.
    const understood = res.status === 201 || res.status === 200 || (res.status === 409 && text.includes("pull_exists"));
    assert.ok(understood, `${key} -> ${res.status} ${text}`);
    n++;
  }
  assert.ok(n >= 6);
  assert.ok(checkedResults >= 4, `${checkedResults} results validated`);
});

test("documented query parameters are ones the server really reads", async () => {
  const { queries } = await import("../src/api/openapi-schemas.ts");
  const fs = await import("node:fs");
  const source = fs.readFileSync(new URL("../src/api/app.ts", import.meta.url), "utf8");
  const app = await createApp({ db: await openDb(":memory:"), store: new MemoryStore() });
  const doc = (await (await app.request("/v1/openapi.json")).json()) as { paths: Record<string, Record<string, S>> };
  for (const [key, list] of Object.entries(queries)) {
    const [method, path] = key.split(" ");
    const params = (doc.paths[path]?.[method]?.parameters ?? []) as { name: string; in: string }[];
    for (const q of list) {
      assert.ok(params.some((p) => p.in === "query" && p.name === q.name), `${key} documents ${q.name}`);
      assert.ok(source.includes(`query("${q.name}")`), `${key}: the server reads ?${q.name}`);
    }
  }
});
