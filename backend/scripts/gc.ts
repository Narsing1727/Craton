// Collect chunks nothing references any more. Dry run by default: it only reports.
//
//   npm run gc                     # what would be removed
//   npm run gc -- --apply          # remove it (chunks unreferenced for more than 30 days)
//   npm run gc -- --grace-days 60  # a longer grace period

import { createContext } from "../src/services/context.ts";
import { collectGarbage } from "../src/services/gc.ts";

const apply = process.argv.includes("--apply");
const i = process.argv.indexOf("--grace-days");
const graceDays = i === -1 ? 30 : Number(process.argv[i + 1]);
const r = await collectGarbage(createContext(), { apply, graceDays });
const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`;
console.log(`${r.totalChunks} chunks: ${r.referenced} referenced, ${r.unreferenced} unreferenced (${r.inGracePeriod} still in the ${graceDays}-day grace period).`);
console.log(apply ? `Removed ${r.removed} chunks (${mb(r.eligibleBytes)}).` : `Would remove ${r.eligible} chunks (${mb(r.eligibleBytes)}). Run with --apply to do it.`);
