"""Exercises craton.py against a running server; prints one JSON object. Used by the backend's CLI test."""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from craton import Craton, CratonError  # noqa: E402

c = Craton(os.environ["CRATON_SERVER"], token=os.environ.get("CRATON_TOKEN"))
repo = c.repo("alice", "basin")
rows = repo.table("gauges.csv")
releases = repo.releases()
commits = repo.commits(limit=5)
cmp_ = repo.compare(commits[-1]["sha"], commits[0]["sha"]) if len(commits) > 1 else None
stats = repo.raster_stats("terrain/basin_dem.tif", base=commits[-1]["sha"], ref=commits[0]["sha"]) if len(commits) > 1 else None
try:
    repo.read("no/such/file.csv")
    missing = None
except CratonError as err:
    missing = {"status": err.status, "code": err.code}
streamed = sum(1 for _ in repo.rows("gauges.csv"))
every = list(repo.all_commits(page=2))
newest = commits[0]["timestamp"]
recent = repo.commits(since=newest, limit=50)
paged = repo.commits(limit=1, offset=1)
issue = repo.create_issue("From the SDK", body="Created by check_sdk.py", label="question")
rel = repo.create_release("v9.9.0-sdk.1", title="SDK check", notes="made by the Python client", prerelease=True)
held = repo.lock("terrain/basin_dem.tif", reason="sdk check")
held_listed = any(l["path"] == "terrain/basin_dem.tif" for l in repo.locks())
repo.unlock("terrain/basin_dem.tif")
released = not any(l["path"] == "terrain/basin_dem.tif" for l in repo.locks())
try:
    repo.create_release("not-a-version")
    refused = None
except CratonError as err:
    refused = err.status
print(json.dumps({
    "me": c.me().get("handle"),
    "repos": [r["name"] for r in c.repos(owner="alice")],
    "paths": sorted(p["path"] for p in repo.paths()),
    "rows": len(rows),
    "columns": list(rows[0].keys()),
    "first_station": rows[0]["station"],
    "bytes": len(repo.read("terrain/basin_dem.tif")),
    "commits": len(commits),
    "compare_changes": [ch["path"] for ch in (cmp_ or {}).get("changes", [])],
    "stats_has_change": bool(stats and stats.get("change")),
    "openapi": c.openapi()["openapi"],
    "missing": missing,
    "issue_title": issue["title"],
    "release_tag": rel["tag"],
    "release_prerelease": rel["prerelease"],
    "lock_holder": held["holder"],
    "lock_listed": held_listed,
    "lock_released": released,
    "bad_tag_status": refused,
    "streamed_rows": streamed,
    "all_commits": len(every),
    "all_commits_sorted_newest_first": [c["timestamp"] for c in every] == sorted((c["timestamp"] for c in every), reverse=True),
    "since_newest": len(recent),
    "second_commit_matches_page": bool(paged) and len(commits) > 1 and paged[0]["sha"] == commits[1]["sha"],
}))
