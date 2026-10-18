// Webhooks that post into Slack, Microsoft Teams and Discord: the host is recognised, the message is written in the shape
// each service reads, nothing a person typed can ping a room, and none of it carries a signature a room cannot check.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { createApp } from "../src/api/app.ts";
import { openDb } from "../src/db/db.ts";
import { MemoryStore } from "../src/storage/chunk-store.ts";
import type { Ctx } from "../src/services/context.ts";
import { config } from "../src/config.ts";
import { chatBody, detectFormat, summarize } from "../src/services/chatformat.ts";
import { deliverDue } from "../src/services/webhooks.ts";

const repo = { owner: "hydrolab", name: "chalakudy-basin" };

test("the chat services' own webhook addresses are recognised; anything else is signed JSON", () => {
  assert.equal(detectFormat("https://hooks.slack.com/services/T000/B000/XXXX"), "slack");
  assert.equal(detectFormat("https://acme.webhook.office.com/webhookb2/abc"), "teams");
  assert.equal(detectFormat("https://prod-12.westus.logic.azure.com:443/workflows/abc/triggers/manual/paths/invoke"), "teams");
  assert.equal(detectFormat("https://discord.com/api/webhooks/123/token"), "discord");
  assert.equal(detectFormat("https://discord.com/api/webhooks/123/token/slack"), "slack", "Discord's Slack-compatible address takes Slack's shape");
  assert.equal(detectFormat("https://example.org/hooks/craton"), "json");
  assert.equal(detectFormat("https://hooks.slack.com.evil.example/x"), "json", "a look-alike host is not Slack");
  assert.equal(detectFormat("not a url"), "json");
});

test("each event becomes one plain sentence with a link", () => {
  const push = summarize(repo, "push", { branch: "main", before: "a".repeat(40), after: "b".repeat(40), pusher: "priyam", commits: [{ sha: "c0ffee1234567", message: "Re-survey rows 900 to 950\n\nlong body", author: "priyam" }, { sha: "deadbeef9999", message: "Fix CRS", author: "arunn" }] });
  assert.equal(push.headline, "priyam pushed 2 commits to main in hydrolab/chalakudy-basin");
  assert.deepEqual(push.lines, ["c0ffee1  Re-survey rows 900 to 950", "deadbee  Fix CRS"]);
  assert.match(push.url, /\/hydrolab\/chalakudy-basin\/commits\/main$/);
  assert.equal(summarize(repo, "push", { branch: "levee", before: null, pusher: "x", commits: [] }).headline, "x created branch levee in hydrolab/chalakudy-basin");
  assert.equal(summarize(repo, "pull_request", { action: "opened", number: 142, title: "Levee scenario", source: "levee", target: "main", author: "arunn" }).headline, "arunn opened pull request #142 in hydrolab/chalakudy-basin");
  assert.equal(summarize(repo, "pull_request", { action: "merged", number: 142, title: "t", source: "a", target: "b", mergedBy: "priyam" }).headline, "priyam merged pull request #142 in hydrolab/chalakudy-basin");
  assert.match(summarize(repo, "release", { tag: "v1.2.0", title: "2024 terrain", prerelease: false, commit: "a", merkleRoot: "f".repeat(64), author: "priyam" }).headline, /priyam published release v1\.2\.0/);
  assert.equal(summarize(repo, "issue", { action: "closed", number: 7, title: "x", by: "sarat" }).headline, "sarat closed issue #7 in hydrolab/chalakudy-basin");
  assert.equal(summarize(repo, "lock", { action: "locked", path: "model/river.g01", reason: "recalibrating", holder: "arunn" }).lines[0], "Reason: recalibrating");
  assert.match(summarize(repo, "lock", { action: "unlocked", path: "model/river.g01", by: "priyam", forced: true }).headline, /released the lock on model\/river\.g01 .* \(forced\)/);
  assert.match(summarize(repo, "ping", {}).headline, /connected to hydrolab\/chalakudy-basin/);
});

test("Slack gets mrkdwn blocks, with markup characters in people's words made literal", () => {
  const body = chatBody("slack", repo, "pull_request", { action: "opened", number: 1, title: "<!channel> deploy <https://evil.example|click> & more", source: "a", target: "b", author: "x" }) as any;
  assert.equal(typeof body.text, "string");
  const text = body.blocks[0].text.text as string;
  assert.ok(!text.includes("<!channel>") && text.includes("&lt;!channel&gt;"), text);
  assert.ok(text.includes("&amp; more"));
  assert.equal(body.blocks[1].elements[0].text, "<http://localhost:3100/hydrolab/chalakudy-basin/pull/1|Open in Craton>".replace("http://localhost:3100", config.webUrl.replace(/\/+$/, "")));
  assert.equal(body.unfurl_links, false);
});

test("Teams gets an Adaptive Card with an Open action, and Discord an embed that cannot ping anyone", () => {
  const teams = chatBody("teams", repo, "issue", { action: "opened", number: 7, title: "**bold** @everyone", label: "bug", author: "sarat" }) as any;
  assert.equal(teams.type, "message");
  const card = teams.attachments[0].content;
  assert.equal(teams.attachments[0].contentType, "application/vnd.microsoft.card.adaptive");
  assert.equal(card.type, "AdaptiveCard");
  assert.equal(card.actions[0].type, "Action.OpenUrl");
  assert.ok(!JSON.stringify(card).includes("**bold**"), "markdown in a title is made literal");
  const discord = chatBody("discord", repo, "issue", { action: "opened", number: 7, title: "hello @everyone", label: "bug", author: "sarat" }) as any;
  assert.deepEqual(discord.allowed_mentions, { parse: [] });
  assert.ok(!discord.embeds[0].description.includes("@everyone"), "the @ is broken so it cannot become a mention");
  assert.ok(discord.embeds[0].url.endsWith("/issues/7"));
});

// ── End to end: a webhook with a chat format delivers the chat shape, unsigned ─────────────────────────────────

let ctx: Ctx;
let app: ReturnType<typeof createApp>;
let receiver: http.Server;
let receiverUrl = "";
const received: { headers: http.IncomingHttpHeaders; body: string }[] = [];
let token = "";

const call = async (method: string, path: string, body?: unknown) => {
  const res = await app.request(`/v1${path}`, { method, headers: { authorization: `Bearer ${token}`, ...(body !== undefined ? { "content-type": "application/json" } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
};

before(async () => {
  config.webhooks.allowPrivate = true;
  config.webhooks.autoDeliver = false;
  receiver = http.createServer((req, res) => {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      received.push({ headers: req.headers, body });
      res.end("ok");
    });
  });
  await new Promise<void>((r) => receiver.listen(0, "127.0.0.1", r));
  receiverUrl = `http://127.0.0.1:${(receiver.address() as AddressInfo).port}/services/T0/B0/xyz`;
  ctx = { db: openDb(":memory:"), store: new MemoryStore() };
  app = createApp(ctx);
  const res = await app.request("/v1/auth/signup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "rhea", email: "rhea@example.org", password: "a-very-long-password" }) });
  token = ((await res.json()) as { token: string }).token;
  assert.equal((await call("POST", "/repos", { name: "basin", visibility: "private" })).status, 201);
});
after(async () => {
  config.webhooks.allowPrivate = false;
  config.webhooks.autoDeliver = true;
  await new Promise((r) => receiver.close(r));
});

test("a Slack webhook is created without a secret, gets a Slack-shaped test message, and no signature headers", async () => {
  const made = await call("POST", "/repos/rhea/basin/webhooks", { url: receiverUrl, events: ["issue"], format: "slack" });
  assert.equal(made.status, 201);
  assert.equal(made.json.format, "slack");
  assert.ok(!("secret" in made.json), "a chat room can't check a signature, so none is offered");
  await deliverDue(ctx);
  assert.equal(received.length, 1);
  const body = JSON.parse(received[0].body);
  assert.match(body.text, /Craton is connected to rhea\/basin/);
  assert.ok(Array.isArray(body.blocks));
  assert.equal(received[0].headers["webhook-signature"], undefined);
  assert.equal(received[0].headers["x-craton-event"], "ping");
});

test("a real event arrives as a message, and a plain webhook still gets the signed envelope", async () => {
  received.length = 0;
  const json = await call("POST", "/repos/rhea/basin/webhooks", { url: receiverUrl.replace("/services/T0/B0/xyz", "/plain"), events: ["issue"] });
  assert.equal(json.json.format, "json");
  assert.match(json.json.secret, /^whsec_/);
  await deliverDue(ctx);
  received.length = 0;
  assert.equal((await call("POST", "/repos/rhea/basin/issues", { title: "Gauge 4 is drifting <!here>", label: "bug" })).status, 201);
  await deliverDue(ctx);
  assert.equal(received.length, 2);
  const chat = received.find((r) => JSON.parse(r.body).blocks);
  const signed = received.find((r) => JSON.parse(r.body).type === "issue");
  assert.ok(chat && signed);
  assert.match(JSON.parse(chat!.body).blocks[0].text.text, /rhea opened issue #1 in rhea\/basin/);
  assert.ok(!chat!.body.includes("<!here>"), "the room is not pinged");
  assert.match(String(signed!.headers["webhook-signature"]), /^v1,/);
});

test("the format is detected from the address when it is not given, can be changed, and a wrong name is refused", async () => {
  const auto = await call("POST", "/repos/rhea/basin/webhooks", { url: "https://hooks.slack.com/services/T0/B0/zzz", events: ["push"] });
  assert.equal(auto.json.format, "slack");
  const bad = await call("POST", "/repos/rhea/basin/webhooks", { url: "https://example.org/hook", events: ["push"], format: "sms" });
  assert.equal(bad.status, 400);
  const patched = await call("PATCH", `/repos/rhea/basin/webhooks/${auto.json.id}`, { format: "discord" });
  assert.equal(patched.json.format, "discord");
  const moved = await call("PATCH", `/repos/rhea/basin/webhooks/${auto.json.id}`, { url: "https://acme.webhook.office.com/webhookb2/abc" });
  assert.equal(moved.json.format, "teams", "a new address brings its own format");
  const listed = await call("GET", "/repos/rhea/basin/webhooks");
  assert.ok(listed.json.webhooks.length >= 3 && listed.json.webhooks.every((h: { format: string }) => typeof h.format === "string"));
});
