import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { readEnv, upsertEnv } from "../src/dev/envfile.ts";

test("a setting is replaced in place, a new one is appended, and everything else is left alone", () => {
  const before = "# my settings\nPORT=4000\nCRATON_GOOGLE_CLIENT_ID=old\n\nOTHER=1\n";
  const after = upsertEnv(before, { CRATON_GOOGLE_CLIENT_ID: "new-id", CRATON_GOOGLE_CLIENT_SECRET: "s3cret" });
  assert.equal(after, "# my settings\nPORT=4000\nCRATON_GOOGLE_CLIENT_ID=new-id\n\nOTHER=1\nCRATON_GOOGLE_CLIENT_SECRET=s3cret\n");
});

test("values with spaces, quotes or # are quoted and read back unchanged", () => {
  const v = 'a "b" # c';
  assert.equal(readEnv(upsertEnv("", { CRATON_X: v })).CRATON_X, v);
  assert.equal(upsertEnv("", { CRATON_X: "plain-1.2/x" }), "CRATON_X=plain-1.2/x\n");
});

test("the setup script writes the file, asks for both halves, and names the addresses to register", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "craton-env-"));
  const file = path.join(dir, ".env");
  const run = (...a: string[]) =>
    spawnSync(process.execPath, ["--disable-warning=ExperimentalWarning", path.resolve(import.meta.dirname, "../scripts/setup-oauth.ts"), ...a], { env: { ...process.env, CRATON_ENV_FILE: file }, encoding: "utf8" });
  const half = run("--google-id", "abc.apps.googleusercontent.com");
  assert.equal(half.status, 2);
  assert.match(half.stderr, /Google needs both/);
  const ok = run("--google-id", "abc.apps.googleusercontent.com", "--google-secret", "GOCSPX-test", "--web-url", "https://craton.nerolith.in/");
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /https:\/\/craton\.nerolith\.in\/auth\/google\/callback/);
  assert.deepEqual(readEnv(fs.readFileSync(file, "utf8")), { CRATON_GOOGLE_CLIENT_ID: "abc.apps.googleusercontent.com", CRATON_GOOGLE_CLIENT_SECRET: "GOCSPX-test", CRATON_WEB_URL: "https://craton.nerolith.in/" });
  assert.equal(run().status, 2);
});

test("the API reads the settings file: Google turns on without any environment variable", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "craton-env-"));
  const file = path.join(dir, ".env");
  fs.writeFileSync(file, "CRATON_GOOGLE_CLIENT_ID=id.apps.googleusercontent.com\nCRATON_GOOGLE_CLIENT_SECRET=shh\n");
  const script = "import('./src/services/oauth.ts').then((m) => console.log(m.googleEnabled()))";
  const read = (env: Record<string, string>) =>
    spawnSync(process.execPath, ["--disable-warning=ExperimentalWarning", "--input-type=module", "-e", script], { cwd: path.resolve(import.meta.dirname, ".."), env: { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("CRATON_GOOGLE_"))), ...env }, encoding: "utf8" }).stdout.trim();
  assert.equal(read({ CRATON_ENV_FILE: file }), "true");
  assert.equal(read({ CRATON_ENV_FILE: path.join(dir, "missing.env") }), "false");
});
