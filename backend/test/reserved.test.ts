// Names that cannot be registered: the web app's own pages, the service's, and "ghost".

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createApp } from "../src/api/app.ts";
import { openDb } from "../src/db/db.ts";
import { MemoryStore } from "../src/storage/chunk-store.ts";
import { RESERVED_HANDLES } from "../src/services/accounts.ts";

test("every top-level page of the web app is a reserved name", () => {
  const app = path.resolve(import.meta.dirname, "../../frontend/app");
  const pages = new Set<string>();
  const add = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      if (e.name.startsWith("(")) add(path.join(dir, e.name)); // a route group: its children are top-level pages
      else if (!e.name.startsWith("[") && !e.name.startsWith("_") && !e.name.startsWith("@")) pages.add(e.name);
    }
  };
  add(app);
  // A folder whose name could not be a handle anyway (sitemap.xml) needs no reservation.
  const missing = [...pages].filter((p) => /^[a-z0-9][a-z0-9-]*$/.test(p) && !RESERVED_HANDLES.has(p));
  assert.deepEqual(missing, [], `reserve these in RESERVED_HANDLES: ${missing.join(", ")}`);
});

test("signup and organization creation refuse a reserved name, and ordinary names still work", async () => {
  const app = createApp({ db: openDb(":memory:"), store: new MemoryStore() });
  const post = (p: string, body: unknown, token?: string) =>
    app.request(`/v1${p}`, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  for (const name of ["ghost", "dashboard", "admin", "api"]) {
    const res = await post("/auth/signup", { username: name, email: `${name}@example.org`, password: "a-very-long-password" });
    assert.equal(res.status, 409, name);
    assert.match(((await res.json()) as { error: { message: string } }).error.message, /reserved/);
  }
  const ok = await post("/auth/signup", { username: "dashboards", email: "d@example.org", password: "a-very-long-password" });
  assert.equal(ok.status, 201, "a name that merely starts like a page is fine");
  const token = ((await ok.json()) as { token: string }).token;
  assert.equal((await post("/orgs", { handle: "settings", name: "S" }, token)).status, 409);
  assert.equal((await post("/orgs", { handle: "hydro-lab", name: "Lab" }, token)).status, 201);
});
