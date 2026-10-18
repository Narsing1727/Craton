#!/usr/bin/env node
// Craton MCP server over stdio (newline-delimited JSON-RPC 2.0, MCP revision 2024-11-05). Read only.
//
//   CRATON_SERVER   API origin, default http://localhost:4000
//   CRATON_TOKEN    personal access token, needed for private repositories
//
// Add to an assistant's MCP configuration as: node --disable-warning=ExperimentalWarning <path>/src/mcp/server.ts

import { blame, listFiles, listReleases, pullOwners, rasterStats, tableFit, textDiff, whatChanged, type Get, type GetText } from "./tools.ts";

const server = (process.env.CRATON_SERVER ?? "http://localhost:4000").replace(/\/$/, "");
const token = process.env.CRATON_TOKEN;

async function fetchOk(p: string) {
  const res = await fetch(`${server}/v1${p}`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      const j = (await res.json()) as { error?: { message?: string } };
      if (j.error?.message) message = j.error.message;
    } catch {}
    throw new Error(message);
  }
  return res;
}
const get: Get = async (p) => (await fetchOk(p)).json();
const getText: GetText = async (p) => (await fetchOk(p)).text();

const str = (description: string) => ({ type: "string", description });
type Args = Record<string, string>;
const TOOLS: { name: string; description: string; inputSchema: { type: "object"; properties: Record<string, unknown>; required: string[] }; run: (a: Args) => Promise<string> }[] = [
  {
    name: "craton_what_changed",
    description: "What changed in a Craton repository since a release: commits, changed files, and for GeoTIFFs (DEMs) the change in cell values. Defaults to the latest release and the default branch.",
    inputSchema: {
      type: "object",
      properties: {
        owner: str("Repository owner handle"),
        repo: str("Repository name"),
        since: str("Release tag, branch or commit to compare from. Default: the latest release."),
        until: str("Branch, tag or commit to compare to. Default: the default branch."),
        filter: str('Only files whose path contains this text, or of this data type (for example "dem", ".tif", "HEC-RAS")'),
      },
      required: ["owner", "repo"],
    },
    run: (a) => whatChanged(get, a.owner, a.repo, { since: a.since, until: a.until, filter: a.filter }),
  },
  {
    name: "craton_list_releases",
    description: "Releases of a Craton repository, newest first.",
    inputSchema: { type: "object", properties: { owner: str("Repository owner handle"), repo: str("Repository name") }, required: ["owner", "repo"] },
    run: (a) => listReleases(get, a.owner, a.repo),
  },
  {
    name: "craton_list_files",
    description: "Files in a Craton repository at a branch, tag or commit, with data type and size. Defaults to the default branch.",
    inputSchema: {
      type: "object",
      properties: { owner: str("Repository owner handle"), repo: str("Repository name"), ref: str("Branch, tag or commit. Default: the default branch."), filter: str('Only paths containing this text, or of this data type (for example "DEM", "gauges")') },
      required: ["owner", "repo"],
    },
    run: (a) => listFiles(get, a.owner, a.repo, { ref: a.ref, filter: a.filter }),
  },
  {
    name: "craton_table_fit",
    description: "Goodness of fit (NSE, KGE, PBIAS, RMSE) of a simulated column against an observed column of a CSV in a Craton repository, overall and per station when a station column is named.",
    inputSchema: {
      type: "object",
      properties: {
        owner: str("Repository owner handle"),
        repo: str("Repository name"),
        path: str("Path of the CSV in the repository"),
        obs: str("Observed column name"),
        sim: str("Simulated column name"),
        by: str("Optional station column to report each station separately"),
        ref: str("Branch, tag or commit. Default: main."),
      },
      required: ["owner", "repo", "path", "obs", "sim"],
    },
    run: (a) => tableFit(getText, a.owner, a.repo, a.path, a.ref || "main", a.obs, a.sim, a.by),
  },
  {
    name: "craton_blame",
    description: "Which commit last rewrote each part (byte range) of a file in a Craton repository. For a DEM re-surveyed in strips, this says which commit changed which strip.",
    inputSchema: {
      type: "object",
      properties: { owner: str("Repository owner handle"), repo: str("Repository name"), path: str("Path of the file"), ref: str("Branch, tag or commit. Default: the default branch.") },
      required: ["owner", "repo", "path"],
    },
    run: (a) => blame(get, a.owner, a.repo, a.path, a.ref),
  },
  {
    name: "craton_text_diff",
    description: "The changed lines of a text file (HEC-RAS plan or geometry file, SWMM .inp, config, README) between two versions of a Craton repository. Defaults: from the latest release to the default branch.",
    inputSchema: {
      type: "object",
      properties: { owner: str("Repository owner handle"), repo: str("Repository name"), path: str("Path of the text file"), since: str("Release tag, branch or commit to compare from"), until: str("Branch, tag or commit to compare to") },
      required: ["owner", "repo", "path"],
    },
    run: (a) => textDiff(get, a.owner, a.repo, a.path, a.since, a.until),
  },
  {
    name: "craton_pull_owners",
    description: "The code owners (from CODEOWNERS) of the files a pull request changes, and whether each has approved the current version.",
    inputSchema: {
      type: "object",
      properties: { owner: str("Repository owner handle"), repo: str("Repository name"), number: str("Pull request number") },
      required: ["owner", "repo", "number"],
    },
    run: (a) => pullOwners(get, a.owner, a.repo, Number(a.number)),
  },
  {
    name: "craton_raster_stats",
    description: "Cell statistics of a GeoTIFF at two versions and the change between them.",
    inputSchema: {
      type: "object",
      properties: { owner: str("Repository owner handle"), repo: str("Repository name"), path: str("Path of the .tif in the repository"), base: str("Earlier release tag, branch or commit"), ref: str("Later branch, tag or commit") },
      required: ["owner", "repo", "path", "base", "ref"],
    },
    run: (a) => rasterStats(get, a.owner, a.repo, a.path, a.base, a.ref),
  },
];

type Request = { jsonrpc: "2.0"; id?: number | string; method: string; params?: { name?: string; arguments?: Args } };
const send = (m: unknown) => process.stdout.write(JSON.stringify(m) + "\n");
const reply = (id: Request["id"], result: unknown) => send({ jsonrpc: "2.0", id, result });
const fail = (id: Request["id"] | null, code: number, message: string) => send({ jsonrpc: "2.0", id, error: { code, message } });

async function handle(req: Request) {
  if (req.id === undefined) return; // a notification such as notifications/initialized
  switch (req.method) {
    case "initialize":
      return reply(req.id, {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "craton", version: "0.1.0" },
        instructions: "Read-only access to Craton repositories: releases, what changed since a release, and raster statistics.",
      });
    case "ping":
      return reply(req.id, {});
    case "tools/list":
      return reply(req.id, { tools: TOOLS.map(({ run: _run, ...t }) => t) });
    case "tools/call": {
      const tool = TOOLS.find((t) => t.name === req.params?.name);
      if (!tool) return fail(req.id, -32602, `Unknown tool ${req.params?.name}`);
      const args = req.params?.arguments ?? {};
      const missing = tool.inputSchema.required.filter((k) => typeof args[k] !== "string" || !args[k].trim());
      if (missing.length) return reply(req.id, { isError: true, content: [{ type: "text", text: `Missing: ${missing.join(", ")}` }] });
      try {
        return reply(req.id, { content: [{ type: "text", text: await tool.run(args) }] });
      } catch (err) {
        // A tool failure is a result the assistant can read and react to, not a protocol error.
        return reply(req.id, { isError: true, content: [{ type: "text", text: err instanceof Error ? err.message : String(err) }] });
      }
    }
    default:
      return fail(req.id, -32601, `Method not found: ${req.method}`);
  }
}

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk: string) => {
  buffer += chunk;
  let nl: number;
  while ((nl = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, nl).trim();
    buffer = buffer.slice(nl + 1);
    if (!line) continue;
    let req: Request;
    try {
      req = JSON.parse(line) as Request;
    } catch {
      fail(null, -32700, "Parse error");
      continue;
    }
    void handle(req);
  }
});
