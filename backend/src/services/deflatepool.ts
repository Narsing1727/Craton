// Making DEFLATE streams again without stopping the server: a few worker threads that each run one job at a time. Small inputs
// are done in place (a thread costs more than they do). If threads cannot be started the work is done in place too, slower but
// the same bytes.

import { Worker } from "node:worker_threads";
import os from "node:os";
import { deflateWith, type DeflateParams } from "../core/rezip.ts";

type Job = { raw: Buffer; params: DeflateParams; resolve: (b: Buffer) => void; reject: (e: Error) => void };

const IN_PLACE_BELOW = 64 * 1024;
const size = () => Math.max(1, Math.min(4, os.cpus().length - 1));

class Pool {
  private readonly idle: Worker[] = [];
  private readonly busy = new Map<Worker, { id: number; job: Job }>();
  private readonly queue: Job[] = [];
  private started = 0;
  private failed = false;
  private next = 1;

  run(raw: Buffer, params: DeflateParams): Promise<Buffer> {
    if (raw.length < IN_PLACE_BELOW || this.failed) return Promise.resolve(deflateWith(raw, params));
    return new Promise((resolve, reject) => {
      this.queue.push({ raw, params, resolve, reject });
      this.pump();
    });
  }

  private spawn(): Worker | null {
    if (this.started >= size()) return null;
    try {
      const w = new Worker(new URL("../core/deflate-worker.ts", import.meta.url));
      w.on("message", (m: { id: number; out?: Uint8Array; error?: string }) => {
        const entry = this.busy.get(w);
        if (!entry || entry.id !== m.id) return;
        this.busy.delete(w);
        this.idle.push(w);
        w.unref();
        if (m.out) entry.job.resolve(Buffer.from(m.out.buffer, m.out.byteOffset, m.out.byteLength));
        else entry.job.reject(new Error(m.error ?? "deflate failed"));
        this.pump();
      });
      w.on("error", () => this.lose(w));
      w.on("exit", () => this.lose(w));
      w.unref(); // after the listeners: adding one makes the worker count again
      this.started++;
      return w;
    } catch {
      this.failed = true;
      return null;
    }
  }

  /** A worker died: its job (and every waiting one) is done in place instead. */
  private lose(w: Worker) {
    const entry = this.busy.get(w);
    this.busy.delete(w);
    const at = this.idle.indexOf(w);
    if (at >= 0) this.idle.splice(at, 1);
    this.started = Math.max(0, this.started - 1);
    this.failed = true;
    const rest = entry ? [entry.job, ...this.queue.splice(0)] : this.queue.splice(0);
    for (const j of rest) {
      try {
        j.resolve(deflateWith(j.raw, j.params));
      } catch (e) {
        j.reject(e as Error);
      }
    }
  }

  private pump() {
    while (this.queue.length) {
      const w = this.idle.pop() ?? this.spawn();
      if (!w) return this.failed && !this.started ? this.drainInPlace() : undefined;
      const job = this.queue.shift()!;
      const id = this.next++;
      this.busy.set(w, { id, job });
      w.ref(); // a job in flight keeps the process alive; an idle worker does not
      w.postMessage({ id, raw: job.raw, params: job.params });
    }
  }

  private drainInPlace() {
    for (const j of this.queue.splice(0)) {
      try {
        j.resolve(deflateWith(j.raw, j.params));
      } catch (e) {
        j.reject(e as Error);
      }
    }
  }
}

const pool = new Pool();

/** The DEFLATE stream of `raw` with these settings (exactly what `deflateWith` gives), made off the main thread when it is large. */
export const deflateAsync = (raw: Buffer, params: DeflateParams) => pool.run(raw, params);
