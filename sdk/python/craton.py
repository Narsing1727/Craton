"""Craton client for Python: one file, standard library only.

    from craton import Craton

    c = Craton("http://localhost:4000", token="crt_pat_...")      # token optional for public repositories
    repo = c.repo("hydrolab", "chalakudy-basin")
    repo.releases()                                               # newest first
    repo.read("gauges.csv")                                       # bytes of a file at the default branch
    rows = repo.table("gauges.csv")                               # list of dicts, one per row
    repo.raster_stats("terrain/basin_dem.tif", base="v1.0.0")     # cell statistics and change against a version
    repo.compare("v1.0.0", "main")                                # files and commits between two versions

Reads, plus a few writes (issues, releases, locks); files themselves go through the CLI (`craton push`). Errors raise CratonError with the API's own code and message.
"""

from __future__ import annotations

import csv
import io
import itertools
import json
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Dict, Iterator, List, Optional

__all__ = ["Craton", "Repo", "CratonError"]


class CratonError(Exception):
    """An error answer from the API: `code` is stable, `message` is written for people."""

    def __init__(self, status: int, code: str, message: str):
        super().__init__(f"{message} ({code}, HTTP {status})")
        self.status = status
        self.code = code
        self.message = message


class Craton:
    def __init__(self, server: str = "http://localhost:4000", token: Optional[str] = None, timeout: float = 60.0):
        self.server = server.rstrip("/")
        self.token = token
        self.timeout = timeout

    # -- transport -----------------------------------------------------------

    def _request(self, path: str, query: Optional[Dict[str, str]] = None, headers: Optional[Dict[str, str]] = None) -> bytes:
        with self._open(path, query, headers) as res:
            return res.read()

    def _open(self, path: str, query: Optional[Dict[str, str]] = None, headers: Optional[Dict[str, str]] = None):
        """The open HTTP response, for callers that read it as a stream. Errors raise CratonError. `headers` adds request headers (Range)."""
        url = f"{self.server}/v1{path}"
        if query:
            url += "?" + urllib.parse.urlencode({k: v for k, v in query.items() if v is not None})
        req = urllib.request.Request(url, headers={"Accept": "application/json", **(headers or {})})
        if self.token:
            req.add_header("Authorization", f"Bearer {self.token}")
        try:
            return urllib.request.urlopen(req, timeout=self.timeout)
        except urllib.error.HTTPError as err:
            code, message = "http_error", err.reason or "request failed"
            try:
                body = json.loads(err.read().decode("utf-8"))
                code = body["error"].get("code", code)
                message = body["error"].get("message", message)
            except Exception:
                pass
            raise CratonError(err.code, code, str(message)) from None

    def get(self, path: str, **query: Optional[str]) -> Any:
        """GET a JSON endpoint under /v1 and return the parsed body."""
        return json.loads(self._request(path, query).decode("utf-8"))

    def send(self, method: str, path: str, body: Optional[Dict[str, Any]] = None) -> Any:
        """POST, PUT, PATCH or DELETE a JSON endpoint under /v1; returns the parsed answer (None for 204). Needs a token with write access."""
        data = json.dumps(body).encode("utf-8") if body is not None else None
        req = urllib.request.Request(f"{self.server}/v1{path}", data=data, method=method.upper(), headers={"Accept": "application/json"})
        if data is not None:
            req.add_header("Content-Type", "application/json")
        if self.token:
            req.add_header("Authorization", f"Bearer {self.token}")
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as res:
                raw = res.read()
                return json.loads(raw.decode("utf-8")) if raw else None
        except urllib.error.HTTPError as err:
            code, message = "http_error", err.reason or "request failed"
            try:
                parsed = json.loads(err.read().decode("utf-8"))
                code = parsed["error"].get("code", code)
                message = parsed["error"].get("message", message)
            except Exception:
                pass
            raise CratonError(err.code, code, str(message)) from None

    # -- account and discovery -----------------------------------------------

    def me(self) -> Dict[str, Any]:
        return self.get("/user")

    def repos(self, owner: Optional[str] = None, q: Optional[str] = None) -> List[Dict[str, Any]]:
        return self.get("/repos", owner=owner, q=q)

    def repo(self, owner: str, name: str) -> "Repo":
        return Repo(self, owner, name)

    def openapi(self) -> Dict[str, Any]:
        """The API's own description, generated from the server's routes."""
        return self.get("/openapi.json")


def _q(s: str) -> str:
    return urllib.parse.quote(s, safe="")


def _qpath(s: str) -> str:
    return "/".join(_q(p) for p in s.split("/"))


class Repo:
    def __init__(self, client: Craton, owner: str, name: str):
        self.client = client
        self.owner = owner
        self.name = name
        self._base = f"/repos/{_q(owner)}/{_q(name)}"

    def __repr__(self) -> str:
        return f"Repo({self.owner}/{self.name})"

    def info(self) -> Dict[str, Any]:
        return self.client.get(self._base)

    @property
    def default_branch(self) -> str:
        info = self.info()
        return info.get("defaultBranch") or info.get("default_branch") or "main"

    # -- writes (a token with write access; files themselves go through the CLI) -------

    def create_issue(self, title: str, body: str = "", label: str = "question", assignee: Optional[str] = None, file: Optional[str] = None) -> Dict[str, Any]:
        payload: Dict[str, Any] = {"title": title, "body": body, "label": label}
        if assignee:
            payload["assignee"] = assignee
        if file:
            payload["file"] = file
        return self.client.send("POST", f"{self._base}/issues", payload)

    def create_release(self, tag: str, title: str = "", notes: str = "", target: Optional[str] = None, prerelease: bool = False) -> Dict[str, Any]:
        payload: Dict[str, Any] = {"tag": tag, "title": title or tag, "notes": notes, "prerelease": prerelease}
        if target:
            payload["target"] = target
        return self.client.send("POST", f"{self._base}/releases", payload)

    def locks(self) -> List[Dict[str, Any]]:
        return self.client.get(f"{self._base}/locks")

    def lock(self, path: str, reason: str = "") -> Dict[str, Any]:
        """Say you are editing a file nobody else should change."""
        return self.client.send("POST", f"{self._base}/locks", {"path": path, "reason": reason})

    def unlock(self, path: str, force: bool = False) -> None:
        self.client.send("DELETE", f"{self._base}/locks/{_qpath(path)}" + ("?force=true" if force else ""))

    # -- history and releases ------------------------------------------------

    def commits(
        self,
        ref: Optional[str] = None,
        limit: int = 30,
        since: Optional[str] = None,
        until: Optional[str] = None,
        author: Optional[str] = None,
        offset: int = 0,
    ) -> List[Dict[str, Any]]:
        """Newest first. `since` and `until` are ISO dates or times; `offset` pages through a long history (limit is at most 500)."""
        return self.client.get(
            f"{self._base}/commits", ref=ref, limit=str(limit), since=since, until=until, author=author, offset=str(offset) if offset else None
        )

    def all_commits(self, ref: Optional[str] = None, since: Optional[str] = None, until: Optional[str] = None, author: Optional[str] = None, page: int = 200) -> Iterator[Dict[str, Any]]:
        """Every matching commit, newest first, fetched a page at a time."""
        offset = 0
        while True:
            batch = self.commits(ref, limit=page, since=since, until=until, author=author, offset=offset)
            yield from batch
            if len(batch) < page:
                return
            offset += page

    def releases(self) -> List[Dict[str, Any]]:
        return self.client.get(f"{self._base}/releases")

    def compare(self, base: str, head: str) -> Dict[str, Any]:
        """Commits and file changes from `base` to `head` (branches, tags or commit ids)."""
        return self.client.get(f"{self._base}/compare/{_q(base)}...{_q(head)}")

    # -- files ---------------------------------------------------------------

    def paths(self, ref: Optional[str] = None) -> List[Dict[str, Any]]:
        """Every file at a ref with its size."""
        return self.client.get(f"{self._base}/paths/{_q(ref or self.default_branch)}")["files"]

    def file_info(self, path: str, ref: Optional[str] = None) -> Dict[str, Any]:
        return self.client.get(f"{self._base}/file/{_q(ref or self.default_branch)}/{_qpath(path)}")

    def read(self, path: str, ref: Optional[str] = None) -> bytes:
        """A file's bytes, all of them. For part of a big file use the fsspec filesystem (craton_fsspec), which reads byte ranges."""
        return self.client._request(f"{self._base}/raw/{_q(ref or self.default_branch)}/{_qpath(path)}")

    def text(self, path: str, ref: Optional[str] = None, encoding: str = "utf-8") -> str:
        return self.read(path, ref).decode(encoding)

    def table(self, path: str, ref: Optional[str] = None, delimiter: Optional[str] = None) -> List[Dict[str, str]]:
        """A CSV or TSV file as a list of dicts keyed by header. Values stay strings; convert what you need."""
        text = self.text(path, ref).lstrip("﻿")
        if delimiter is None:
            first = text.split("\n", 1)[0]
            delimiter = max([",", "\t", ";", "|"], key=first.count)
        return list(csv.DictReader(io.StringIO(text), delimiter=delimiter))

    def raster_stats(self, path: str, base: str, ref: Optional[str] = None, size: Optional[int] = None) -> Dict[str, Any]:
        """Cell statistics of a GeoTIFF at `ref` and at `base`, and the change between them."""
        return self.client.get(
            f"{self._base}/raster-stats/{_q(ref or self.default_branch)}/{_qpath(path)}",
            base=base,
            size=str(size) if size else None,
        )

    def rows(self, path: str, ref: Optional[str] = None, delimiter: Optional[str] = None) -> Iterator[Dict[str, str]]:
        """A CSV or TSV file one row at a time, read as it arrives rather than held in memory (the API serves files up to 16 MB this way)."""
        res = self.client._open(f"{self._base}/raw/{_q(ref or self.default_branch)}/{_qpath(path)}")
        try:
            lines = io.TextIOWrapper(res, encoding="utf-8-sig", newline="")
            if delimiter is None:
                first = lines.readline()
                delimiter = max([",", "	", ";", "|"], key=first.count)
                lines = itertools.chain([first], lines)
            yield from csv.DictReader(lines, delimiter=delimiter)
        finally:
            res.close()

    def iter_rows(self, path: str, ref: Optional[str] = None) -> Iterator[Dict[str, str]]:
        """Kept for older scripts; use rows()."""
        yield from self.rows(path, ref)
