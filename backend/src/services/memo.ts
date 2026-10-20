// A small cache for results that cannot change: a commit's tree, a file's facts at a commit, a commit's list of changes. Their keys contain the commit's
// id, which is a hash of everything in it, so an entry is never wrong, only unneeded, and nothing has to be invalidated. It lives in this process (a second
// server builds its own), is bounded by size, forgets entries after a while (names and checks change around them), and makes concurrent requests for the same
// thing share one computation instead of each doing it.
//
// What goes in is the finished answer (JSON text), so a hit costs a lookup and not a database round trip, and nothing mutable is ever handed out.

const MAX_BYTES = 48 * 1024 * 1024;
const DEFAULT_TTL_MS = 10 * 60_000;

type Entry = { text: string; at: number; ttl: number };
const entries = new Map<string, Entry>(); // insertion order = least recently used first
const inFlight = new Map<string, Promise<string>>();
let bytes = 0;

export const memoStats = { hit: 0, miss: 0, shared: 0, evicted: 0 };

function drop(key: string) {
  const e = entries.get(key);
  if (!e) return;
  bytes -= e.text.length;
  entries.delete(key);
}

function put(key: string, text: string, ttl: number) {
  if (text.length > MAX_BYTES / 8) return; // one huge answer should not push out everything else
  drop(key);
  entries.set(key, { text, at: Date.now(), ttl });
  bytes += text.length;
  while (bytes > MAX_BYTES) {
    const oldest = entries.keys().next().value;
    if (oldest === undefined) break;
    drop(oldest);
    memoStats.evicted++;
  }
}

/** The JSON text of `make()`, remembered under `key`. Callers send the text as the response body. */
export async function memoJson(key: string, make: () => Promise<unknown>, ttlMs = DEFAULT_TTL_MS): Promise<string> {
  const hit = entries.get(key);
  if (hit && Date.now() - hit.at < hit.ttl) {
    entries.delete(key);
    entries.set(key, hit); // most recently used
    memoStats.hit++;
    return hit.text;
  }
  const running = inFlight.get(key);
  if (running) {
    memoStats.shared++;
    return running;
  }
  memoStats.miss++;
  const work = make()
    .then((value) => {
      const text = JSON.stringify(value);
      put(key, text, ttlMs);
      return text;
    })
    .finally(() => inFlight.delete(key));
  inFlight.set(key, work);
  return work;
}

/** For tests and for a reset after the data underneath was replaced. */
export function memoClear() {
  entries.clear();
  inFlight.clear();
  bytes = 0;
  memoStats.hit = memoStats.miss = memoStats.shared = memoStats.evicted = 0;
}

export const memoSize = () => ({ entries: entries.size, bytes });
