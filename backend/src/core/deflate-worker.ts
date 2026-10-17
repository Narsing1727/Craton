// Runs in a worker thread: makes a DEFLATE stream again for services/deflatepool.ts. Compressing a few megabytes of pixels takes
// a good part of a second, which is too long to hold up the server's main thread.

import { parentPort } from "node:worker_threads";
import { deflateWith, type DeflateParams } from "./rezip.ts";

parentPort!.on("message", (job: { id: number; raw: Uint8Array; params: DeflateParams }) => {
  try {
    const out = new Uint8Array(deflateWith(job.raw, job.params));
    parentPort!.postMessage({ id: job.id, out }, [out.buffer]);
  } catch (err) {
    parentPort!.postMessage({ id: job.id, error: err instanceof Error ? err.message : String(err) });
  }
});
