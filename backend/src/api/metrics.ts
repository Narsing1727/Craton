// What a running server can say about itself, in the Prometheus text format (scraped by Prometheus, CloudWatch agent, Grafana Alloy, Datadog):
// request counts and latencies by route, how many requests were refused for rate, the database pool, and how well the caches are doing.
// Served at /metrics only when CRATON_METRICS_TOKEN is set, to a caller that sends it as a Bearer token. Counts are per server and start
// at zero when it does, as Prometheus expects.

import { timingSafeEqual } from "node:crypto";

export const counters = {
  rateLimited: 0,
  pageCache: { hit: 0, miss: 0 },
  databaseUnavailable: 0,
};

const BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

type Series = { count: number; sum: number; buckets: number[] };
const requests = new Map<string, number>(); // "METHOD|route|status" -> count
const durations = new Map<string, Series>(); // "route" -> latency histogram (all methods)

/** Record one finished request. `route` is the route pattern (not the URL), so the number of series stays small. */
export function observe(method: string, route: string, status: number, seconds: number) {
  const key = `${method}|${route}|${status}`;
  requests.set(key, (requests.get(key) ?? 0) + 1);
  let s = durations.get(route);
  if (!s) durations.set(route, (s = { count: 0, sum: 0, buckets: BUCKETS.map(() => 0) }));
  s.count++;
  s.sum += seconds;
  BUCKETS.forEach((b, i) => {
    if (seconds <= b) s!.buckets[i]++;
  });
}

const esc = (v: string) => v.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");

export type Extra = { version: string; database: { kind: string; pool: { total: number; idle: number; waiting: number } | null }; cache: { kind: string; status: string } };

export function render(extra: Extra): string {
  const out: string[] = [];
  const line = (s: string) => out.push(s);
  line("# HELP craton_info The running version.");
  line("# TYPE craton_info gauge");
  line(`craton_info{version="${esc(extra.version)}",database="${extra.database.kind}",cache="${extra.cache.kind}"} 1`);
  line("# HELP craton_uptime_seconds Seconds since this server started.");
  line("# TYPE craton_uptime_seconds gauge");
  line(`craton_uptime_seconds ${Math.round(process.uptime())}`);
  line("# HELP craton_http_requests_total Requests answered, by method, route and status.");
  line("# TYPE craton_http_requests_total counter");
  for (const [key, n] of requests) {
    const [method, route, status] = key.split("|");
    line(`craton_http_requests_total{method="${method}",route="${esc(route)}",status="${status}"} ${n}`);
  }
  line("# HELP craton_http_request_duration_seconds How long requests took, by route.");
  line("# TYPE craton_http_request_duration_seconds histogram");
  for (const [route, s] of durations) {
    BUCKETS.forEach((b, i) => line(`craton_http_request_duration_seconds_bucket{route="${esc(route)}",le="${b}"} ${s.buckets[i]}`));
    line(`craton_http_request_duration_seconds_bucket{route="${esc(route)}",le="+Inf"} ${s.count}`);
    line(`craton_http_request_duration_seconds_sum{route="${esc(route)}"} ${s.sum}`);
    line(`craton_http_request_duration_seconds_count{route="${esc(route)}"} ${s.count}`);
  }
  line("# HELP craton_rate_limited_total Requests refused because a limit was reached.");
  line("# TYPE craton_rate_limited_total counter");
  line(`craton_rate_limited_total ${counters.rateLimited}`);
  line("# HELP craton_database_unavailable_total Requests answered 503 because the database could not be reached.");
  line("# TYPE craton_database_unavailable_total counter");
  line(`craton_database_unavailable_total ${counters.databaseUnavailable}`);
  line("# HELP craton_page_cache_total Public pages served from the short-lived copy (hit) or read from the database (miss).");
  line("# TYPE craton_page_cache_total counter");
  line(`craton_page_cache_total{result="hit"} ${counters.pageCache.hit}`);
  line(`craton_page_cache_total{result="miss"} ${counters.pageCache.miss}`);
  line("# HELP craton_cache_up 1 when the shared cache is answering, 0 when this server is using local fallbacks.");
  line("# TYPE craton_cache_up gauge");
  line(`craton_cache_up ${extra.cache.status === "ok" ? 1 : 0}`);
  if (extra.database.pool) {
    line("# HELP craton_db_pool_connections Database connections: all, idle, and requests waiting for one.");
    line("# TYPE craton_db_pool_connections gauge");
    line(`craton_db_pool_connections{state="total"} ${extra.database.pool.total}`);
    line(`craton_db_pool_connections{state="idle"} ${extra.database.pool.idle}`);
    line(`craton_db_pool_connections{state="waiting"} ${extra.database.pool.waiting}`);
  }
  const mem = process.memoryUsage();
  line("# HELP craton_process_resident_memory_bytes Resident memory of this server.");
  line("# TYPE craton_process_resident_memory_bytes gauge");
  line(`craton_process_resident_memory_bytes ${mem.rss}`);
  line("# HELP craton_process_heap_used_bytes JavaScript heap in use.");
  line("# TYPE craton_process_heap_used_bytes gauge");
  line(`craton_process_heap_used_bytes ${mem.heapUsed}`);
  return `${out.join("\n")}\n`;
}

/** Whether `header` is `Bearer <token>` with the right token (compared in constant time). */
export function authorized(header: string | undefined, token: string): boolean {
  if (!token || !header?.startsWith("Bearer ")) return false;
  const given = Buffer.from(header.slice(7));
  const want = Buffer.from(token);
  return given.length === want.length && timingSafeEqual(given, want);
}
