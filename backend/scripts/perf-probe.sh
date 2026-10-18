#!/usr/bin/env bash
# Time list-style endpoints against a large generated database (each twice: the second is the warm number).
#   1. createdb craton_perf; start the API once on it so the schema exists; psql -f scripts/perf-seed.sql
#   2. start the API on it (PORT=4002 CRATON_DATABASE_URL=... CRATON_DB_SLOW_MS=30), sign up a user, put its token in $TOKEN_FILE
#   3. bash scripts/perf-probe.sh
B=${CRATON_API:-http://localhost:4002/v1}
T=$(cat "${TOKEN_FILE:-perf_token.txt}")
H="authorization: Bearer $T"
probe() {
  local path="$1"
  local out
  out=$(curl -s -o /dev/null -w "%{http_code} %{time_total}" --max-time 25 -H "$H" "$B$path")
  local out2
  out2=$(curl -s -o /dev/null -w "%{time_total}" --max-time 25 -H "$H" "$B$path")
  printf "%-62s %s  then %ss\n" "$path" "$out" "$out2"
}
probe "/repos"
probe "/repos?limit=50"
probe "/repos?q=basin-19"
probe "/repos?q=catchment"
probe "/repos?owner=user7"
probe "/trending"
probe "/owners/user7"
probe "/owners/org3"
probe "/owners/org3/members"
probe "/repos/user2/basin-1"
probe "/repos/user2/basin-1/issues"
probe "/repos/user2/basin-1/issues?state=closed"
probe "/repos/user2/basin-1/issues/777"
probe "/repos/user2/basin-1/commits?limit=30"
probe "/repos/user2/basin-1/commits?limit=30&path=README.md"
probe "/repos/user2/basin-1/branches"
probe "/repos/user2/basin-1/stats"
probe "/repos/user2/basin-1/insights"
probe "/repos/user2/basin-1/activity"
probe "/user/inbox"
probe "/user/inbox/count"
probe "/user/starred"
probe "/search?q=gauge"
probe "/search?q=basin-19"
probe "/issues"
probe "/pulls"
probe "/orgs/org3/audit-log"
probe "/user/audit-log"
