"use client";

// Branch picker that navigates: the server renders the chosen branch's data.

import { useSoftNav } from "@/lib/use-soft-nav";
import { GitBranch } from "lucide-react";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

export function RefSelect({
  base,
  branches,
  value,
  defaultBranch,
  target,
  path = "",
  className,
  size = "default",
}: {
  base: string;
  branches: string[];
  value: string;
  defaultBranch: string;
  /** Page to open for the chosen branch. */
  target: "code" | "tree" | "commits";
  path?: string;
  className?: string;
  size?: "sm" | "default";
}) {
  const nav = useSoftNav();
  const isBranch = branches.includes(value);

  function hrefFor(ref: string) {
    const r = encodeURIComponent(ref);
    if (target === "tree") return `${base}/tree/${r}${path ? `/${path}` : ""}`;
    if (target === "commits") return ref === defaultBranch ? `${base}/commits` : `${base}/commits?ref=${r}`;
    return ref === defaultBranch ? base : `${base}?ref=${r}`;
  }

  return (
    <Select value={isBranch ? value : "__commit"} onValueChange={(v) => v && v !== "__commit" && nav.go(hrefFor(String(v)))}>
      <SelectTrigger size={size} className={cn("w-48 font-mono", className)} aria-label="Switch branch">
        <GitBranch className="size-3.5" aria-hidden />
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {!isBranch && (
            <SelectItem value="__commit" className="font-mono text-xs">
              {value.slice(0, 7)}
            </SelectItem>
          )}
          {branches.map((b) => (
            <SelectItem key={b} value={b} className="font-mono text-xs">
              {b}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}
