// Check everything the server has stored. Changes nothing; exits 1 when something is wrong.
//
//   npm run fsck               # read and verify every chunk, difference and tile (slow on a large store)
//   npm run fsck -- --quick    # structure only: files add up, Merkle roots match, nothing is read

import { createContext } from "../src/services/context.ts";
import { fsck } from "../src/services/fsck.ts";

const quick = process.argv.includes("--quick");
const ctx = createContext();
const started = Date.now();
let last = 0;
const report = await fsck(ctx, {
  quick,
  progress: (done, total) => {
    if (Date.now() - last > 2000 && process.stdout.isTTY) {
      last = Date.now();
      process.stdout.write(`\r${done.toLocaleString("en-US")} of ${total.toLocaleString("en-US")} chunks`);
    }
  },
});
if (process.stdout.isTTY) process.stdout.write("\r" + " ".repeat(40) + "\r");
const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`;
const line = (what: string, checked: number, bad: string[]) => console.log(`${bad.length ? "FAIL" : "ok  "} ${what}: ${checked.toLocaleString("en-US")} checked${bad.length ? `, ${bad.length} problem${bad.length === 1 ? "" : "s"}` : ""}`);
line(quick ? "chunks (not read: --quick)" : `chunks (${mb(report.chunks.bytes)} read back)`, report.chunks.checked, [...report.chunks.missing, ...report.chunks.corrupt, ...report.chunks.wrongForm]);
line("stored differences' bases", report.bases.checked, report.bases.bad);
line("tiles", report.tiles.checked, report.tiles.bad);
line("files", report.files.checked, report.files.bad);
line("commits", report.commits.checked, report.commits.bad);
const show = (title: string, list: string[]) => list.length && console.log(`\n${title}:\n  ${list.slice(0, 20).join("\n  ")}${list.length > 20 ? `\n  … and ${list.length - 20} more` : ""}`);
show("Chunks that are not stored", report.chunks.missing);
show("Chunks that do not hash to their name", report.chunks.corrupt);
show("Chunks stored in another form than the database says", report.chunks.wrongForm);
show("Bases", report.bases.bad);
show("Tiles", report.tiles.bad);
show("Files", report.files.bad);
show("Commits", report.commits.bad);
console.log(`\n${report.ok ? "Everything checks out" : "Problems found"} (${((Date.now() - started) / 1000).toFixed(1)} s).`);
process.exitCode = report.ok ? 0 : 1;
