// Cross-repository issues and pull requests for the signed-in user, for /issues and /pulls: read from the API; there is nothing to show without it.
import type { IssueWithRepo, PullWithRepo } from "@/components/work-lists";

export const myIssues: (IssueWithRepo & { assignee: string; mentioned?: boolean })[] = [];

export const myPulls: PullWithRepo[] = [];
