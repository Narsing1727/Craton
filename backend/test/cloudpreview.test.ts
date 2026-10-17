// A point cloud seen from above: the preview is a PNG sized to the cloud's shape, coloured by elevation and faded where points are sparse,
// and a compressed (LAZ) or damaged file says why it has none.

import { test, before } from "node:test";
import assert from "node:assert/strict";
import zlib from "node:zlib";
import { createApp } from "../src/api/app.ts";
import { openDb } from "../src/db/db.ts";
import { MemoryStore } from "../src/storage/chunk-store.ts";
import type { Ctx } from "../src/services/context.ts";
import { cloudLimits } from "../src/render/previews.ts";
import { las, W } from "./helpers/lasfile.ts";

let app: ReturnType<typeof createApp>;
let token = "";

async function upload(name: string, data: Buffer) {
  const form = new FormData();
  form.append("file", new File([new Uint8Array(data)], name));
  form.append("paths", JSON.stringify([name]));
  form.append("message", `add ${name}`);
  const res = await app.request("/v1/repos/alice/clouds/upload", { method: "POST", headers: { authorization: `Bearer ${token}` }, body: form });
  assert.equal(res.status, 201, await res.clone().text());
}
const render = (name: string, size = 256, headers: Record<string, string> = {}) => app.request(`/v1/repos/alice/clouds/render/main/${name}?size=${size}`, { headers: { authorization: `Bearer ${token}`, ...headers } });

/** Width, height and RGBA pixels of a PNG made by this server (8-bit RGBA, no filtering). */
function decodePng(png: Buffer) {
  assert.equal(png.subarray(1, 4).toString("latin1"), "PNG");
  let at = 8;
  let width = 0;
  let height = 0;
  const data: Buffer[] = [];
  while (at < png.length) {
    const length = png.readUInt32BE(at);
    const type = png.subarray(at + 4, at + 8).toString("latin1");
    if (type === "IHDR") (width = png.readUInt32BE(at + 8)), (height = png.readUInt32BE(at + 12));
    if (type === "IDAT") data.push(png.subarray(at + 8, at + 8 + length));
    at += 12 + length;
  }
  const raw = zlib.inflateSync(Buffer.concat(data));
  const rgba = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) raw.copy(rgba, y * width * 4, y * (width * 4 + 1) + 1, (y + 1) * (width * 4 + 1));
  return { width, height, rgba };
}

before(async () => {
  const ctx: Ctx = { db: openDb(":memory:"), store: new MemoryStore() };
  app = createApp(ctx);
  const res = await app.request("/v1/auth/signup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "alice", email: "alice@example.org", password: "a-very-long-password" }) });
  token = ((await res.json()) as { token: string }).token;
  ctx.db.prepare("UPDATE users SET plan = 'team', email_verified_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE owner_id = (SELECT id FROM owners WHERE handle = 'alice')").run();
  assert.equal((await app.request("/v1/repos", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ name: "clouds", visibility: "private" }) })).status, 201);
});

test("an uncompressed cloud is drawn from above, in the shape of its bounds, with elevation in colour and its numbers alongside", async () => {
  await upload("cloud.las", las(60_000));
  const res = await render("cloud.las");
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "image/png");
  const meta = JSON.parse(res.headers.get("x-craton-render")!);
  assert.equal(meta.points, 60_000);
  assert.ok(meta.sampledShare > 0 && meta.sampledShare <= 1);
  assert.ok(meta.max > meta.min, "elevation range");
  const { width, height, rgba } = decodePng(Buffer.from(await res.arrayBuffer()));
  assert.deepEqual([width, height], [meta.width, meta.height]);
  assert.equal(Math.max(width, height), 256, "the longest side is the size asked for");
  const colours = new Set<string>();
  let drawn = 0;
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3] > 0) {
      drawn++;
      colours.add(`${rgba[i]},${rgba[i + 1]},${rgba[i + 2]}`);
    }
  }
  assert.ok(drawn > 200, `${drawn} cells drawn`);
  assert.ok(colours.size >= 8, `${colours.size} colours: elevation shows`);
});

test("the answer is cached by content: a second request with its tag gets a 304", async () => {
  const first = await render("cloud.las");
  const tag = first.headers.get("etag")!;
  assert.ok(tag);
  assert.equal((await render("cloud.las", 256, { "if-none-match": tag })).status, 304);
  assert.equal((await render("cloud.las", 128)).headers.get("etag") !== tag, true, "another size is another picture");
});

test("a compressed cloud, a file with no points, and one that is not a cloud say why there is no preview", async () => {
  const laz = las(5_000, { seed: 4 });
  laz[104] |= 0x80;
  await upload("laz.las", laz);
  const res = await render("laz.las");
  assert.equal(res.status, 415);
  assert.match(((await res.json()) as { error: { message: string } }).error.message, /LAZ/);
  await upload("empty.las", las(0));
  assert.equal((await render("empty.las")).status, 415);
  await upload("text.las", Buffer.from("not a point cloud ".repeat(2000)));
  assert.equal((await render("text.las")).status, 415);
});

test("a cloud larger than what is read is sampled evenly across its whole length, so the picture still covers all of it", async () => {
  const pts = 300_000; // 10 MB: about 80 chunks
  await upload("big.las", las(pts, { seed: 8 }));
  const full = JSON.parse((await render("big.las", 200)).headers.get("x-craton-render")!);
  assert.equal(full.sampledShare, 1);
  cloudLimits.chunks = 40;
  try {
    const res = await render("big.las", 201);
    const meta = JSON.parse(res.headers.get("x-craton-render")!);
    assert.equal(meta.points, pts, "the count is the file's, not the sample's");
    assert.ok(meta.sampledShare > 0.3 && meta.sampledShare < 0.7, `read ${meta.sampledShare} of the file`);
    const { width, rgba } = decodePng(Buffer.from(await res.arrayBuffer()));
    const columns = new Set<number>();
    for (let i = 0; i < rgba.length; i += 4) if (rgba[i + 3] > 0) columns.add((i / 4) % width);
    assert.ok(columns.size > width * 0.6, `${columns.size} of ${width} columns have points`);
  } finally {
    cloudLimits.chunks = 512;
  }
  void W;
});
