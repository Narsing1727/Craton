// A load check for a running Craton API: makes a throwaway account and repository, uploads chunks, then reads and writes at a set concurrency
// for a set time and says how it went (requests per second, p50/p95/p99, errors by status, 503 "overloaded" and rate limits).
// It never signs in as a real person; the account it makes is deleted at the end.
//
//   node scripts/load.mjs                         # http://localhost:4000, 20 clients, 15 s
//   node scripts/load.mjs --api http://host:4000 --clients 100 --seconds 60 --chunks 400
//
// Exit code 1 when more than 1 % of requests failed with anything but 429/503 (those are the server saying "slow down", reported separately).

import { createHash, randomBytes } from "node:crypto";

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
};
const API = arg("api", "http://localhost:4000").replace(/\/$/, "");
const CLIENTS = Number(arg("clients", 20));
const SECONDS = Number(arg("seconds", 15));
const CHUNKS = Number(arg("chunks", 100));

const handle = `load${randomBytes(4).toString("hex")}`;
const json = { "content-type": "application/json" };
const call = (method, path, token, body, headers = {}) =>
  fetch(`${API}/v1${path}`, { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers }, body });

const password = randomBytes(12).toString("hex");
const signup = await call("POST", "/auth/signup", null, JSON.stringify({ username: handle, email: `${handle}@example.org`, password }), json);
if (signup.status !== 201) {
  console.error(`could not make a throwaway account: ${signup.status} ${await signup.text()}`);
  process.exit(2);
}
const { token } = await signup.json();
const made = await call("POST", "/repos", token, JSON.stringify({ name: "load", visibility: "private" }), json);
if (made.status !== 201) {
  console.error(`could not make a repository: ${made.status} ${await made.text()}`);
  process.exit(2);
}

// Chunks, in batches of 50: each frame is hash, payload length, encoding byte, payload.
const parts = Array.from({ length: CHUNKS }, (_, i) => Buffer.concat([Buffer.from(`chunk ${i} `), randomBytes(2048)]));
const frame = (d) => {
  const h = Buffer.alloc(69);
  h.write(createHash("sha256").update(d).digest("hex"), 0, 64, "latin1");
  h.writeUInt32BE(d.length, 64);
  h[68] = 0;
  return Buffer.concat([h, d]);
};
const uploadStarted = performance.now();
for (let i = 0; i < parts.length; i += 50) {
  const res = await call("POST", `/repos/${handle}/load/chunks`, token, Buffer.concat(parts.slice(i, i + 50).map(frame)), { "content-type": "application/octet-stream" });
  if (res.status !== 201) {
    console.error(`chunk upload failed: ${res.status} ${await res.text()}`);
    process.exit(2);
  }
}
console.log(`uploaded ${CHUNKS} chunks in ${Math.round(performance.now() - uploadStarted)} ms`);

// What a visitor and a writer do, mixed: public reads (most), authenticated reads, a few writes.
const plan = [
  { name: "health", weight: 2, run: () => call("GET", "/health") },
  { name: "explore", weight: 6, run: () => call("GET", "/repos?limit=20") },
  { name: "trending", weight: 3, run: () => call("GET", "/trending") },
  { name: "repo", weight: 8, run: () => call("GET", `/repos/${handle}/load`, token) },
  { name: "me", weight: 4, run: () => call("GET", "/user", token) },
  { name: "chunk-missing", weight: 3, run: () => call("POST", `/repos/${handle}/load/chunks/missing`, token, JSON.stringify({ hashes: parts.slice(0, 20).map((d) => createHash("sha256").update(d).digest("hex")) }), json) },
  { name: "issue", weight: 1, run: () => call("POST", `/repos/${handle}/load/issues`, token, JSON.stringify({ title: `load ${Math.random()}`, body: "x" }), json) },
];
const bag = plan.flatMap((p) => Array(p.weight).fill(p));

const latencies = new Map(plan.map((p) => [p.name, []]));
const status = new Map();
let total = 0;
const stopAt = performance.now() + SECONDS * 1000;
const started = performance.now();
await Promise.all(
  Array.from({ length: CLIENTS }, async () => {
    while (performance.now() < stopAt) {
      const p = bag[Math.floor(Math.random() * bag.length)];
      const t = performance.now();
      let code;
      try {
        const res = await p.run();
        await res.arrayBuffer();
        code = res.status;
      } catch (err) {
        code = `net:${err.cause?.code ?? err.name}`;
      }
      latencies.get(p.name).push(performance.now() - t);
      status.set(`${p.name} ${code}`, (status.get(`${p.name} ${code}`) ?? 0) + 1);
      total++;
    }
  }),
);
const elapsed = (performance.now() - started) / 1000;

const pct = (a, q) => (a.length ? a.slice().sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * q))] : 0);
console.log(`\n${total} requests in ${elapsed.toFixed(1)} s = ${(total / elapsed).toFixed(0)} per second, ${CLIENTS} clients\n`);
console.log("route            n      p50     p95     p99     max (ms)");
for (const [name, l] of latencies) if (l.length) console.log(`${name.padEnd(14)} ${String(l.length).padStart(6)} ${pct(l, 0.5).toFixed(0).padStart(7)} ${pct(l, 0.95).toFixed(0).padStart(7)} ${pct(l, 0.99).toFixed(0).padStart(7)} ${Math.max(...l).toFixed(0).padStart(7)}`);
console.log("\nanswers:");
let bad = 0;
for (const [k, n] of [...status].sort()) {
  const code = k.split(" ")[1];
  const fine = /^(200|201|204|304|404|429|503)$/.test(code);
  if (!/^(200|201|204|304)$/.test(code)) console.log(`  ${k}: ${n}`);
  if (!fine) bad += n;
}
const slowDown = [...status].filter(([k]) => /( 429| 503)$/.test(k)).reduce((s, [, n]) => s + n, 0);
console.log(`\nok ${total - bad - slowDown}, told to slow down (429/503) ${slowDown}, failed ${bad}`);

// Clean up: the throwaway account and its repository.
await call("DELETE", `/repos/${handle}/load`, token);
const gone = await call("DELETE", "/user", token, JSON.stringify({ handle, password }), json);
if (gone.status !== 204) console.log(`(the throwaway account @${handle} could not be deleted: ${gone.status})`);
process.exit(bad / Math.max(1, total) > 0.01 ? 1 : 0);
