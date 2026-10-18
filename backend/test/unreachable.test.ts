// A server that is not there: the CLI names the address and the reason, points to `craton doctor`, exits with 1 and
// prints no stack trace.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { networkReason, unreachableMessage } from "../src/cli/remote.ts";

const cli = path.resolve(import.meta.dirname, "../src/cli/craton.ts");

function closedPort(): Promise<number> {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address() as net.AddressInfo;
      s.close(() => resolve(port));
    });
  });
}

function run(cwd: string, ...args: string[]) {
  const r = spawnSync(process.execPath, ["--disable-warning=ExperimentalWarning", cli, ...args], { cwd, encoding: "utf8", env: { ...process.env, CRATON_HOME: path.join(cwd, ".home") } });
  return { status: r.status, text: (r.stdout ?? "") + (r.stderr ?? "") };
}

test("the reason comes from the error's cause, in words", () => {
  const refused = Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } });
  assert.match(networkReason(refused), /connection refused/);
  assert.match(networkReason(Object.assign(new TypeError("fetch failed"), { cause: { code: "ENOTFOUND" } })), /host name was not found/);
  assert.equal(networkReason(new Error("boom")), "boom");
  const m = unreachableMessage("http://x:1", refused);
  assert.match(m, /Can’t reach http:\/\/x:1: connection refused/);
  assert.match(m, /craton doctor/);
});

test("clone and auth login against a server that is not running say so and exit with 1", { timeout: 60_000 }, async () => {
  const port = await closedPort();
  const server = `http://127.0.0.1:${port}`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "craton-unreach-"));
  try {
    for (const args of [["auth", "login", "--token", "t", "--server", server], ["clone", `${server}/someone/somewhere`]]) {
      const r = run(dir, ...args);
      assert.equal(r.status, 1, args.join(" "));
      assert.ok(r.text.includes(server), `${args[0]}: names the address`);
      assert.match(r.text, /connection refused/, `${args[0]}: says why`);
      assert.match(r.text, /craton doctor/, `${args[0]}: points to doctor`);
      assert.ok(!/\n\s+at /.test(r.text), `${args[0]}: no stack trace`);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
