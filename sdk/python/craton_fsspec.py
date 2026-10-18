"""A filesystem for Craton, for fsspec: read any file of any version like a local file, fetching only the bytes asked for.

    import fsspec, pandas as pd, xarray as xr

    # owner/repo@version/path   (version = branch, tag or commit; omit @version for the default branch)
    opts = {"server": "https://craton.nerolith.in", "token": "crt_pat_..."}   # or CRATON_SERVER / CRATON_TOKEN
    pd.read_csv("craton://hydrolab/chalakudy-basin@v1.2.0/gauges.csv", storage_options=opts)
    xr.open_dataset(fsspec.open("craton://hydrolab/chalakudy-basin@main/run.nc", **opts).open(), engine="h5netcdf")
    fs = fsspec.filesystem("craton", **opts)
    fs.ls("hydrolab/chalakudy-basin@main/terrain")
    with fs.open("hydrolab/chalakudy-basin@v1.0.0/terrain/basin_dem.tif") as f:   # rasterio.open(f) reads tiles lazily
        header = f.read(4096)

Why a filesystem and not a download: the server answers HTTP byte ranges, so opening a 30 GB raster and reading one window
moves only that window, and `@v1.0.0` pins the exact version a result came from. It is read-only: push changes with the CLI.
A branch moves, so a listing is cached per filesystem object; call `fs.invalidate_cache()` to see a newer one.
A version name with a "/" in it is written with %2F (feature%2Flevee).

Needs fsspec (`pip install fsspec`); craton.py itself has no dependencies.
"""

from __future__ import annotations

import os
import urllib.parse
from typing import Any, Dict, List, Optional, Tuple

from fsspec import AbstractFileSystem, register_implementation
from fsspec.spec import AbstractBufferedFile

from craton import Craton, CratonError

__all__ = ["CratonFileSystem", "CratonFile"]


def _q(s: str) -> str:
    return urllib.parse.quote(s, safe="")


class CratonFileSystem(AbstractFileSystem):
    protocol = "craton"
    root_marker = ""

    def __init__(self, server: Optional[str] = None, token: Optional[str] = None, timeout: float = 60.0, **kwargs: Any):
        super().__init__(**kwargs)
        server = server or os.environ.get("CRATON_SERVER")
        if not server:
            raise ValueError("Say where Craton is: pass server='https://…' in storage_options, or set CRATON_SERVER.")
        self.client = Craton(server, token=token or os.environ.get("CRATON_TOKEN"), timeout=timeout)
        self._files: Dict[Tuple[str, str, str], Dict[str, int]] = {}
        self._default: Dict[Tuple[str, str], str] = {}

    # -- paths ---------------------------------------------------------------

    @classmethod
    def _strip_protocol(cls, path: Any) -> str:
        path = str(path)
        if path.startswith("craton://"):
            path = path[len("craton://"):]
        return path.strip("/")

    def _parse(self, path: str) -> Tuple[str, str, Optional[str], str]:
        """owner/repo[@version]/inner/path -> (owner, repo, version, inner)."""
        parts = self._strip_protocol(path).split("/", 2)
        owner = parts[0]
        repo = parts[1] if len(parts) > 1 else ""
        inner = parts[2] if len(parts) > 2 else ""
        version: Optional[str] = None
        if "@" in repo:
            repo, version = repo.split("@", 1)
            version = urllib.parse.unquote(version) or None
        return owner, repo, version, inner.strip("/")

    def _ref(self, owner: str, repo: str, version: Optional[str]) -> str:
        if version:
            return version
        key = (owner, repo)
        if key not in self._default:
            info = self.client.get(f"/repos/{_q(owner)}/{_q(repo)}")
            self._default[key] = info.get("defaultBranch") or info.get("default_branch") or "main"
        return self._default[key]

    def _listing(self, owner: str, repo: str, ref: str) -> Dict[str, int]:
        key = (owner, repo, ref)
        if key not in self._files:
            try:
                body = self.client.get(f"/repos/{_q(owner)}/{_q(repo)}/paths/{urllib.parse.quote(ref, safe='')}")
            except CratonError as err:
                if err.status == 404:
                    raise FileNotFoundError(f"{owner}/{repo}@{ref}: {err.message}") from None
                raise
            self._files[key] = {f["path"]: int(f["size"]) for f in body["files"]}
        return self._files[key]

    def invalidate_cache(self, path: Optional[str] = None) -> None:
        self._files.clear()
        self._default.clear()
        super().invalidate_cache(path)

    # -- listing and details -------------------------------------------------

    def ls(self, path: str, detail: bool = True, **kwargs: Any) -> List[Any]:
        owner, repo, version, inner = self._parse(path)
        prefix_name = f"{owner}/{repo}" + (f"@{_q(version)}" if version else "")
        if not owner:
            raise FileNotFoundError("Name an owner: craton://owner/repo@version/path")
        if not repo:
            try:
                repos = self.client.get("/repos", owner=owner)
            except CratonError as err:
                raise FileNotFoundError(err.message) from None
            entries = [{"name": f"{owner}/{r['name']}", "size": 0, "type": "directory"} for r in repos]
            return entries if detail else [e["name"] for e in entries]
        files = self._listing(owner, repo, self._ref(owner, repo, version))
        if inner and inner in files:
            entry = {"name": f"{prefix_name}/{inner}", "size": files[inner], "type": "file"}
            return [entry] if detail else [entry["name"]]
        base = inner + "/" if inner else ""
        out: Dict[str, Dict[str, Any]] = {}
        for p, size in files.items():
            if not p.startswith(base):
                continue
            rest = p[len(base):]
            head, sep, _ = rest.partition("/")
            if sep:
                out.setdefault(head, {"name": f"{prefix_name}/{base}{head}", "size": 0, "type": "directory"})
            else:
                out[head] = {"name": f"{prefix_name}/{p}", "size": size, "type": "file"}
        if inner and not out:
            raise FileNotFoundError(f"{path}: no such file or folder")
        entries = sorted(out.values(), key=lambda e: e["name"])
        return entries if detail else [e["name"] for e in entries]

    def info(self, path: str, **kwargs: Any) -> Dict[str, Any]:
        owner, repo, version, inner = self._parse(path)
        prefix_name = f"{owner}/{repo}" + (f"@{_q(version)}" if version else "")
        if not repo or not inner:
            return {"name": prefix_name if repo else owner, "size": 0, "type": "directory"}
        files = self._listing(owner, repo, self._ref(owner, repo, version))
        if inner in files:
            return {"name": f"{prefix_name}/{inner}", "size": files[inner], "type": "file"}
        if any(p.startswith(inner + "/") for p in files):
            return {"name": f"{prefix_name}/{inner}", "size": 0, "type": "directory"}
        raise FileNotFoundError(path)

    # -- reading -------------------------------------------------------------

    def cat_file(self, path: str, start: Optional[int] = None, end: Optional[int] = None, **kwargs: Any) -> bytes:
        owner, repo, version, inner = self._parse(path)
        if not inner:
            raise IsADirectoryError(path)
        url = f"/repos/{_q(owner)}/{_q(repo)}/raw/{_q(self._ref(owner, repo, version))}/{'/'.join(_q(p) for p in inner.split('/'))}"
        headers: Dict[str, str] = {}
        if start is not None or end is not None:
            if start is not None and start < 0:
                headers["Range"] = f"bytes={start}"  # the last -start bytes: "bytes=-n"
                if end is not None:
                    raise ValueError("A negative start can't be combined with an end.")
            else:
                first = start or 0
                if end is not None and end < 0:
                    size = self.info(path)["size"]
                    end = size + end
                if end is not None and end <= first:
                    return b""
                headers["Range"] = f"bytes={first}-{'' if end is None else end - 1}"
        try:
            return self.client._request(url, headers=headers)
        except CratonError as err:
            if err.status == 404:
                raise FileNotFoundError(path) from None
            if err.status == 416:
                return b""
            raise

    def _open(self, path: str, mode: str = "rb", block_size: Optional[int] = None, autocommit: bool = True, cache_options: Optional[dict] = None, **kwargs: Any) -> "CratonFile":
        if mode != "rb":
            raise NotImplementedError("Craton is read-only through fsspec. Push changes with the CLI: craton push.")
        details = self.info(path)
        if details["type"] != "file":
            raise IsADirectoryError(path)
        return CratonFile(self, path, mode="rb", block_size=block_size, autocommit=autocommit, cache_options=cache_options, size=details["size"], **kwargs)


class CratonFile(AbstractBufferedFile):
    """A file at one version, read by byte range."""

    def _fetch_range(self, start: int, end: int) -> bytes:
        return self.fs.cat_file(self.path, start=start, end=end)


register_implementation("craton", CratonFileSystem, clobber=True)
