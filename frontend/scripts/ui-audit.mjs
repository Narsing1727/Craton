// The contrast scan and the keyboard walk on the pages that need data of their own (a repository with an issue, a comment and a
// release), on a throwaway account so the demo user's security log is not written to. Start the API with a throwaway
// CRATON_DATA_DIR first.
//   CRATON_E2E_DATABASE_URL=<postgres address> node scripts/ui-audit.mjs

import { spawnSync } from "node:child_process";

const API = process.env.CRATON_API_URL ?? "http://localhost:4000";
const handle = `audit${Date.now().toString(36)}`;
const r = await fetch(`${API}/v1/auth/signup`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: handle, email: `${handle}@example.org`, password: "a-very-long-password" }) });
if (!r.ok) throw new Error(`signup failed: ${r.status} ${await r.text()}`);
const { token } = await r.json();
const h = { authorization: `Bearer ${token}`, "content-type": "application/json" };
await fetch(`${API}/v1/user`, { method: "PATCH", headers: h, body: JSON.stringify({ onboarded: true }) });
const { openE2eDb } = await import("./e2e-db.mjs");
const db = await openE2eDb();
await db.prepare("UPDATE users SET email_verified_at = now_iso(), plan = 'team' WHERE owner_id = (SELECT id FROM owners WHERE handle = ?)").run(handle);
await db.close();
const must = async (res, what) => {
  if (!res.ok) throw new Error(`${what} failed: ${res.status} ${await res.text()}`);
  return res.json();
};
await must(await fetch(`${API}/v1/repos`, { method: "POST", headers: h, body: JSON.stringify({ name: "basin", visibility: "public", sample: true }) }), "repo");
const R = `${API}/v1/repos/${handle}/basin`;
const issue = await must(await fetch(`${R}/issues`, { method: "POST", headers: h, body: JSON.stringify({ title: "Gauge 4 reads high" }) }), "issue");
const c = await must(await fetch(`${R}/issues/${issue.number}/comments`, { method: "POST", headers: h, body: JSON.stringify({ body: "Looks like the datum." }) }), "comment");
await fetch(`${R}/comments/${c.id}/reactions/rocket`, { method: "PUT", headers: h });
await must(await fetch(`${R}/releases`, { method: "POST", headers: h, body: JSON.stringify({ tag: "v1.0.0", run: { software: "HEC-RAS", version: "6.5", plan: "p01", runtimeSeconds: 5400 } }) }), "release");

const B = `/${handle}/basin`;
const routes = [`/${handle}`, B, `${B}/issues`, `${B}/issues/${issue.number}`, `${B}/releases`, `${B}/releases/new`, `${B}/pulls`, "/settings", "/settings/security", "/settings/notifications", "/settings/preferences", "/settings/tokens", "/orgs/new", "/new"].join(",");
let failed = 0;
for (const script of ["contrast-scan.mjs", "focus-walk.mjs"]) {
  console.log(`\n== ${script} ==`);
  const run = spawnSync(process.execPath, [`scripts/${script}`], { stdio: "inherit", env: { ...process.env, CRATON_ROUTES: routes, CRATON_SESSION_TOKEN: token } });
  if (run.status !== 0) failed++;
}
process.exitCode = failed ? 1 : 0;
