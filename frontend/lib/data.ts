// Shared mock data for Craton — a version-control platform for hydro/GIS engineers.
// Everything here is illustrative sample content used to render the UI.

export type DataType =
  | "DEM"
  | "Shapefile"
  | "LiDAR"
  | "NetCDF"
  | "HEC-RAS"
  | "HEC-HMS"
  | "SWMM"
  | "EPANET"
  | "GeoTIFF"
  | "Zarr";

export const dataTypeColors: Record<DataType, string> = {
  DEM: "bg-muted/30 text-foreground border-border",
  Shapefile: "bg-muted/30 text-foreground border-border",
  LiDAR: "bg-muted/30 text-foreground border-border",
  NetCDF: "bg-muted/30 text-foreground border-border",
  "HEC-RAS": "bg-muted/30 text-foreground border-border",
  "HEC-HMS": "bg-muted/30 text-foreground border-border",
  SWMM: "bg-muted/30 text-foreground border-border",
  EPANET: "bg-muted/30 text-foreground border-border",
  GeoTIFF: "bg-muted/30 text-foreground border-border",
  Zarr: "bg-muted/30 text-foreground border-border",
};

export type Repo = {
  owner: string;
  name: string;
  description: string;
  tags: DataType[];
  size: string;
  updated: string;
  visibility: "public" | "private";
  stars: number;
  forks: number;
  region: string;
  defaultBranch: string;
  /** SPDX id from the API's licence list, or empty. */
  license?: string;
  topics?: string[];
  footprint?: [number, number, number, number] | null;
  /** EPSG code of the vertical datum, or null when the repository hasn't said. */
  lockPatterns?: string[];
  verticalDatum?: number | null;
  /** The value that marks cells without data, or null. */
  nodata?: number | null;
  forkedFrom?: string;
};

export const repos: Repo[] = [];

export function getRepo(owner: string, name: string): Repo {
  return { owner, name, description: "", tags: [], size: "—", updated: "", visibility: "public", stars: 0, forks: 0, region: "", defaultBranch: "main" };
}

export type FileNode = {
  name: string;
  type: "dir" | "raster" | "vector" | "table" | "text" | "model";
  size: string;
  lastCommit: string;
  updated: string;
  dataType?: DataType;
  /** Full path in the repository (live data). */
  path?: string;
  /** Last commit that touched the entry (live data). */
  sha?: string;
};

export const fileTree: FileNode[] = [];

export const folderTree: Record<string, FileNode[]> = {};

export function getFolderContents(_folderPath: string): FileNode[] {
  return [];
}

export const readmeContent = "";

export type Commit = {
  sha: string;
  message: string;
  author: string;
  authorHandle: string;
  timestamp: string;
  sizeDelta: string;
  branch?: string;
  /** ISO time, parent SHAs and Merkle root (live data). */
  isoTime?: string;
  parents?: string[];
  merkleRoot?: string;
  files: {
    name: string;
    dataType?: DataType;
    added: number;
    changed: number;
    removed: number;
    /** Chunks carried over unchanged from the previous version (unit "chunks"). */
    reused?: number;
    change?: "added" | "removed" | "modified";
    /** Chunk layout of the new version: "n" new, "s" shared (live data). */
    map?: string;
    sizeBefore?: number;
    sizeAfter?: number;
    unit: "tiles" | "features" | "rows" | "cells" | "chunks";
  }[];
};

export const commits: Commit[] = [];

export type Branch = {
  name: string;
  lastCommit: string;
  author: string;
  updated: string;
  ahead: number;
  behind: number;
  isDefault?: boolean;
  /** Head commit SHA (live data). */
  sha?: string;
};

export const branches: Branch[] = [];

export type PullRequest = {
  id: number;
  title: string;
  author: string;
  source: string;
  target: string;
  status: "open" | "merged" | "closed" | "changes-requested" | "approved";
  comments: number;
  updated: string;
  description: string;
  checks?: "passed" | "failed" | "running";
  head?: string;
  approvals?: number;
  /** Handles that reviewed it (live data). */
  reviewers?: string[];
  /** People specifically asked to review this and who haven't yet. */
  reviewRequests?: string[];
};

export const pullRequests: PullRequest[] = [];

export type Issue = {
  id: number;
  title: string;
  author: string;
  status: "open" | "closed";
  label: "data-quality" | "question" | "enhancement" | "bug";
  comments: number;
  updated: string;
  reference?: string;
  body?: string;
  /** When it was opened, relative (live data). */
  opened?: string;
  assignee?: string | null;
  milestone?: string | null;
};

export const issues: Issue[] = [];

export type Release = {
  version: string;
  title: string;
  sha: string;
  date: string;
  author: string;
  notes: string;
  size: string;
  latest?: boolean;
  prerelease?: boolean;
  merkleRoot?: string;
  checksums?: { path: string; size: number; sha256: string }[];
  /** The model run the release was made from, when it says. */
  run?: { software?: string; version?: string; plan?: string; runtimeSeconds?: number; completedAt?: string; notes?: string; inputs?: { repo: string; commit: string; note?: string }[] } | null;
};

export const releases: Release[] = [];

export type Activity = {
  type: "commit" | "branch" | "comment" | "pr" | "mention" | "release" | "issue" | "review";
  actor: string;
  text: string;
  repo: string;
  time: string;
  read?: boolean;
  href?: string;
  detail?: string;
  /** ISO time (live data). */
  at?: string;
};

export const activityFeed: Activity[] = [];

export type Member = {
  handle: string;
  name: string;
  role: "Owner" | "Maintainer" | "Member";
  repos: number;
};

export const orgMembers: Member[] = [];

export const tokens: { name: string; created: string; lastUsed: string; scope: string }[] = [];

export const sshKeys: { name: string; fingerprint: string; created: string; lastUsed: string }[] = [];

export const contributionActivity: string[] = [];

export const commitActivity: { week: string; commits: number }[] = [];
