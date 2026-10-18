"use client";

// Repository summary loaded once by app/[owner]/[repo]/layout.tsx and read by the header on every
// repository page. Null outside a repository route.

import { createContext, useContext } from "react";
import type { Repo } from "@/lib/data";

export type RepoContextValue = {
  live: boolean;
  repo: Repo;
  openIssues: number;
  openPulls: number;
  branchCount: number;
  commitCount: number;
  /** Whether the signed-in viewer starred it. */
  starred: boolean;
  /** What the signed-in viewer may do here (a visitor can only read). */
  access: "none" | "read" | "write" | "admin";
};

const RepoContext = createContext<RepoContextValue | null>(null);

export function RepoProvider({ value, children }: { value: RepoContextValue; children: React.ReactNode }) {
  return <RepoContext.Provider value={value}>{children}</RepoContext.Provider>;
}

export function useRepoSummary() {
  return useContext(RepoContext);
}

/** Whether the signed-in viewer may change this repository: its owner, an organization's members, or an invited collaborator with Write. */
export function useCanWrite(): boolean {
  const access = useContext(RepoContext)?.access;
  return access === "write" || access === "admin";
}
