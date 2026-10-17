"""Exercises craton_fsspec.py against a running server; prints one JSON object. Used by the backend's CLI test."""
import hashlib
import json
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import fsspec  # noqa: E402
from craton import Craton  # noqa: E402
import craton_fsspec  # noqa: E402,F401

server, token = os.environ["CRATON_SERVER"], os.environ.get("CRATON_TOKEN")
opts = {"server": server, "token": token}
sdk = Craton(server, token=token).repo("alice", "basin")
commits = sdk.commits(limit=2)
whole = sdk.read("terrain/basin_dem.tif")
fs = fsspec.filesystem("craton", **opts)
ref = commits[0]["sha"]
base = "alice/basin"

listing = fs.ls(f"{base}/terrain", detail=True)
info = fs.info(f"{base}@main/terrain/basin_dem.tif")
with fs.open(f"{base}@{ref}/terrain/basin_dem.tif") as f:
    f.seek(1234)
    middle = f.read(5000)
    f.seek(-100, 2)
    tail = f.read()
    f.seek(0)
    head = f.read(16)
via_url = fsspec.open(f"craton://{base}@main/gauges.csv", "rb", **opts).open().read()
try:
    fs.open(f"{base}/gauges.csv", "wb")
    readonly = None
except NotImplementedError:
    readonly = True
try:
    fs.info(f"{base}@main/nope.tif")
    missing = None
except FileNotFoundError:
    missing = True
print(json.dumps({
    "listing": sorted((e["name"].split("/", 2)[2], e["type"]) for e in listing),
    "size": info["size"],
    "size_ok": info["size"] == len(whole),
    "middle_ok": middle == whole[1234:6234],
    "tail_ok": tail == whole[-100:],
    "head_ok": head == whole[:16],
    "sha_ok": hashlib.sha256(fs.cat_file(f"{base}@main/terrain/basin_dem.tif")).hexdigest() == hashlib.sha256(whole).hexdigest(),
    "pair_ok": fs.cat_file(f"{base}@main/terrain/basin_dem.tif", start=10, end=20) == whole[10:20],
    "negative_ok": fs.cat_file(f"{base}@main/terrain/basin_dem.tif", start=-7) == whole[-7:],
    "csv_ok": via_url == sdk.read("gauges.csv"),
    "glob": sorted(fs.glob(f"{base}@main/vectors/*.shp")),
    "isdir": fs.isdir(f"{base}@main/terrain"),
    "isfile": fs.isfile(f"{base}@main/gauges.csv"),
    "readonly": readonly,
    "missing": missing,
}))
