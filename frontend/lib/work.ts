// Cross-repository issues and pull requests for the signed-in user (priyam), for /issues and /pulls.
import { issues, pullRequests, type Issue } from "@/lib/data";
import type { IssueWithRepo, PullWithRepo } from "@/components/work-lists";

const R = "hydrolab/chalakudy-basin";

export const myIssues: (IssueWithRepo & { assignee: string; mentioned?: boolean })[] = [
  ...issues.map((i) => ({ ...i, repo: R, assignee: i.id === 88 || i.id === 76 ? "priyam" : "arunn" })),
  {
    id: 31,
    title: "Rainfall grids for 2019 have a one-day time shift",
    author: "sarat",
    status: "open" as const,
    label: "data-quality" as Issue["label"],
    comments: 4,
    updated: "1 day ago",
    reference: "grids/2019.zarr",
    repo: "hydrolab/monsoon-rainfall-grids",
    assignee: "priyam",
  },
  {
    id: 57,
    title: "Document the design storm used for the Maastricht network",
    author: "vikramr",
    status: "open" as const,
    label: "question" as Issue["label"],
    comments: 2,
    updated: "3 days ago",
    repo: "deltares/rhine-meuse-swmm",
    assignee: "vikramr",
    mentioned: true,
  },
];

export const myPulls: PullWithRepo[] = [
  ...pullRequests.map((p) => ({
    ...p,
    repo: R,
    checks: (p.id === 131 ? "passed" : "failed") as PullWithRepo["checks"],
    reviewRequested: p.author !== "priyam" && p.status !== "merged",
  })),
  {
    id: 64,
    title: "Update 2024 design storms for urban catchments",
    author: "vikramr",
    source: "design-storms-2024",
    target: "main",
    status: "open",
    comments: 3,
    updated: "6 hours ago",
    description: "",
    repo: "deltares/rhine-meuse-swmm",
    checks: "passed",
    reviewRequested: true,
  },
  {
    id: 12,
    title: "Add 2024 monsoon reanalysis to the Zarr store",
    author: "priyam",
    source: "reanalysis-2024",
    target: "main",
    status: "approved",
    comments: 1,
    updated: "2 days ago",
    description: "",
    repo: "hydrolab/monsoon-rainfall-grids",
    checks: "running",
  },
];
