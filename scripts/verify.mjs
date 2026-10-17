// One command for "is everything still fine?": the backend and frontend tests, both typechecks and, when the API and the
// web app answer, the route sweep at three widths, the keyboard walk and the contrast scan. A summary table at the end
// and one exit code (0 only when every step that ran passed).
//
//   node scripts/verify.mjs               everything that can run
//   node scripts/verify.mjs --fast        tests and typechecks only
//   node scripts/verify.mjs --only sweep  steps whose name contains "sweep"

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const backend = path.join(root, "backend");
const frontend = path.join(root, "frontend");
const args = process.argv.slice(2);
const fast = args.includes("--fast");
const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : null;
const WEB = process.env.CRATON_WEB ?? "http://localhost:3100";
const API = (process.env.CRATON_API ?? "http://localhost:4000/v1").replace(/\/v1$/, "");

const up = async (url) => {
  try {
    return (await fetch(url, { signal: AbortSignal.timeout(3000) })).ok;
  } catch {
    return false;
  }
};
const live = !fast && (await up(`${API}/v1/health`)) && (await up(`${WEB}/api/health`));

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const npx = process.platform === "win32" ? "npx.cmd" : "npx";
const env = { ...process.env, MSYS_NO_PATHCONV: "1" };

/** @type {{ name: string; cwd: string; cmd: string; args: string[]; env?: Record<string,string>; needsServers?: boolean; summarize?: (out: string) => string }[]} */
const steps = [
  { name: "backend tests", cwd: backend, cmd: npm, args: ["test"], summarize: (o) => (o.match(/ℹ pass (\d+)/)?.[1] ?? "?") + " passed" },
  { name: "backend typecheck", cwd: backend, cmd: npx, args: ["tsc", "--noEmit"] },
  { name: "frontend tests", cwd: frontend, cmd: npm, args: ["test"], summarize: (o) => (o.match(/ℹ pass (\d+)/)?.[1] ?? "?") + " passed" },
  { name: "frontend typecheck", cwd: frontend, cmd: npx, args: ["tsc", "--noEmit"] },
  ...[1280, 640, 390].map((w) => ({ name: `route sweep ${w}px`, cwd: frontend, cmd: npm, args: ["run", "sweep"], env: { CRATON_WIDTH: String(w) }, needsServers: true, summarize: (/** @type {string} */ o) => (o.match(/Sweep clean: (\d+) routes/)?.[1] ?? "?") + " routes" })),
  { name: "keyboard walk", cwd: frontend, cmd: process.execPath, args: ["scripts/focus-walk.mjs"], needsServers: true },
  { name: "contrast scan", cwd: frontend, cmd: process.execPath, args: ["scripts/contrast-scan.mjs"], needsServers: true },
];

// A development server compiles a page the first time it is asked for, which can outlast a browser step's patience.
// Ask for the heavier pages once, patiently, before the browser steps start.
if (live && (!only || only.includes("sweep") || only.includes("walk") || only.includes("contrast"))) {
  process.stdout.write("warming pages ... ");
  for (const p of ["/api-reference", "/docs", "/cli", "/hydrolab/chalakudy-basin", "/hydrolab/chalakudy-basin/settings/webhooks", "/explore", "/pricing"]) {
    try {
      await fetch(`${WEB}${p}`, { signal: AbortSignal.timeout(90_000) });
    } catch {}
  }
  console.log("done");
}

const rows = [];
let failed = 0;
for (const s of steps) {
  if (only && !s.name.includes(only)) continue;
  if (s.needsServers && !live) {
    rows.push({ name: s.name, status: "skipped", seconds: 0, note: fast ? "--fast" : "API or web app not answering" });
    continue;
  }
  process.stdout.write(`${s.name} ... `);
  const t = Date.now();
  const r = spawnSync(s.cmd, s.args, { cwd: s.cwd, env: { ...env, ...(s.env ?? {}) }, encoding: "utf8", shell: process.platform === "win32" && s.cmd.endsWith(".cmd"), maxBuffer: 64 * 1024 * 1024 });
  const seconds = Math.round((Date.now() - t) / 100) / 10;
  const out = (r.stdout ?? "") + (r.stderr ?? "");
  const ok = r.status === 0;
  if (!ok) failed++;
  rows.push({ name: s.name, status: ok ? "pass" : "FAIL", seconds, note: ok ? (s.summarize?.(out) ?? "") : out.trim().split(/\r?\n/).slice(-6).join(" | ").slice(0, 300) });
  console.log(`${ok ? "pass" : "FAIL"} (${seconds}s)`);
}

console.log("");
const width = Math.max(...rows.map((r) => r.name.length));
for (const r of rows) console.log(`${r.status.padEnd(7)} ${r.name.padEnd(width)}  ${String(r.seconds).padStart(6)}s  ${r.note}`);
const ran = rows.filter((r) => r.status !== "skipped").length;
console.log("");
console.log(failed ? `${failed} of ${ran} steps failed.` : `All ${ran} steps passed${rows.some((r) => r.status === "skipped") ? `; ${rows.filter((r) => r.status === "skipped").length} skipped` : ""}.`);
process.exit(failed ? 1 : 0);
