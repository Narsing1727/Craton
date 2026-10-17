# craton-client

A one-file Python client for the [Craton](../../README.md) API. Standard library only.

```python
from craton import Craton

repo = Craton("http://localhost:4000", token="crt_pat_...").repo("hydrolab", "chalakudy-basin")

repo.releases()                                   # newest first
rows = repo.table("gauges.csv")                   # a CSV as a list of dicts
repo.raster_stats("terrain/basin_dem.tif", base="v1.0.0")   # cell statistics and change
repo.create_issue("Datum mismatch", label="bug")  # needs a token with write access
```

Reads: `repos`, `releases`, `commits`, `all_commits`, `compare`, `paths`, `file_info`, `read`, `text`, `table`, `rows`
(streams), `raster_stats`, `locks`, `openapi`. Writes: `create_issue`, `create_release`, `lock`, `unlock`, and
`client.send(method, path, body)` for anything else in the API reference. Files themselves are pushed with the CLI.

Errors raise `CratonError` with the API's `status`, `code` and `message`.

Install from a checkout: `pip install ./sdk/python`.

## Open Craton files in pandas, xarray and rasterio (fsspec)

`pip install "./sdk/python[fsspec]"`, then any tool that takes an fsspec URL can read a file at an exact version, and only the
bytes it asks for are transferred (the server answers HTTP byte ranges):

```python
import pandas as pd, fsspec
opts = {"server": "https://craton.nerolith.in", "token": "crt_pat_..."}      # or CRATON_SERVER / CRATON_TOKEN
df = pd.read_csv("craton://hydrolab/chalakudy-basin@v1.2.0/gauges.csv", storage_options=opts)
fs = fsspec.filesystem("craton", **opts)
fs.ls("hydrolab/chalakudy-basin@main/terrain")
with fs.open("hydrolab/chalakudy-basin@v1.0.0/terrain/basin_dem.tif") as f:    # rasterio.open(f) reads tiles lazily
    f.seek(0); header = f.read(4096)
```

Paths are `owner/repo@version/path` (version is a branch, tag or commit; leave `@version` out for the default branch).
It is read-only: push changes with the CLI.
