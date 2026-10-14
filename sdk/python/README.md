# craton-client

A one-file Python client for the [Craton](../../README.md) API. Standard library only.

```python
from craton import Craton

repo = Craton("http://localhost:4000", token="bcn_pat_...").repo("hydrolab", "chalakudy-basin")

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
