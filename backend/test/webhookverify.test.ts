// The receiver's side: `craton webhook verify` and the snippets in WEBHOOKS.md agree with how the server signs.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { newSecret, sign } from "../src/services/webhooks.ts";

const root = path.resolve(import.meta.dirname, "..");
const guide = fs.readFileSync(path.resolve(root, "../WEBHOOKS.md"), "utf8");
const secret = newSecret();
const body = JSON.stringify({ id: "msg_1", type: "issue", data: { action: "opened", title: "Datum — mismatch" } });
const id = "msg_0123456789abcdef";
const now = Math.floor(Date.now() / 1000);
const signature = sign(secret, id, now, body);

const verifyCli = (args: string[], input?: string) =>
  spawnSync(process.execPath, ["--disable-warning=ExperimentalWarning", path.join(root, "src/cli/craton.ts"), "webhook", "verify", ...args], { encoding: "utf8", input });

test("a genuine delivery is valid; a changed body, a wrong secret and a stale timestamp are not", () => {
  const base = ["--secret", secret, "--id", id, "--timestamp", String(now), "--signature", signature];
  const good = verifyCli(base, body);
  assert.equal(good.status, 0, good.stderr);
  assert.equal(good.stdout.trim(), "valid");

  assert.equal(verifyCli(base, body.replace("opened", "closed")).status, 1, "a changed body");
  assert.equal(verifyCli(["--secret", newSecret(), ...base.slice(2)], body).status, 1, "another secret");

  const old = now - 3600;
  const stale = verifyCli(["--secret", secret, "--id", id, "--timestamp", String(old), "--signature", sign(secret, id, old, body)], body);
  assert.equal(stale.status, 1);
  assert.match(stale.stdout, /timestamp is \d+ seconds off/);
  const skipped = verifyCli(["--secret", secret, "--id", id, "--timestamp", String(old), "--signature", sign(secret, id, old, body), "--tolerance", "0"], body);
  assert.equal(skipped.status, 0, "with the time check off, only the signature matters");

  // A header with two signatures (key rotation) is valid when either matches.
  assert.equal(verifyCli(["--secret", secret, "--id", id, "--timestamp", String(now), "--signature", `v1,AAAA ${signature}`], body).status, 0);
  // The body can come from a file.
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "craton-hook-")), "body.json");
  fs.writeFileSync(file, body);
  assert.equal(verifyCli([...base, "--body-file", file]).status, 0);
});

function snippet(lang: string): string {
  const NL = String.fromCharCode(10);
  const open = "```" + lang + NL;
  const start = guide.indexOf(open);
  assert.ok(start >= 0, `WEBHOOKS.md has a ${lang} snippet`);
  const end = guide.indexOf("```", start + open.length);
  return guide.slice(start + open.length, end);
}

test("the Node.js snippet in the guide accepts a genuine delivery and refuses a tampered one", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "craton-hook-"));
  fs.writeFileSync(path.join(dir, "verify.cjs"), snippet("js"));
  const script = `
const { verify } = require(${JSON.stringify(path.join(dir, "verify.cjs"))});
const headers = { "webhook-id": ${JSON.stringify(id)}, "webhook-timestamp": ${JSON.stringify(String(now))}, "webhook-signature": ${JSON.stringify(signature)} };
const raw = ${JSON.stringify(body)};
console.log(verify(${JSON.stringify(secret)}, headers, raw), verify(${JSON.stringify(secret)}, headers, raw + " "));
`;
  const r = spawnSync(process.execPath, ["-e", script], { encoding: "utf8" });
  assert.equal(r.stdout.trim(), "true false", r.stderr);
});

test("the Python snippet in the guide agrees too", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "craton-hook-"));
  fs.writeFileSync(path.join(dir, "verify_hook.py"), snippet("python"));
  const script = `
import sys, json
sys.path.insert(0, ${JSON.stringify(dir)})
from verify_hook import verify
headers = {"webhook-id": ${JSON.stringify(id)}, "webhook-timestamp": ${JSON.stringify(String(now))}, "webhook-signature": ${JSON.stringify(signature)}}
raw = ${JSON.stringify(body)}
print(verify(${JSON.stringify(secret)}, headers, raw), verify(${JSON.stringify(secret)}, headers, raw + " "))
`;
  const r = spawnSync("python", ["-I", "-c", script], { encoding: "utf8" });
  if (r.error) return; // no Python on this machine
  assert.equal(r.stdout.trim(), "True False", r.stderr);
});
