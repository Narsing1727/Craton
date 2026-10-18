"use client";

import { use, useState } from "react";
import Link from "next/link";
import { FolderGit2, Plus, Search, Shield, UsersRound, Trash2 } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { OrgHeader } from "@/components/org-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { ConfirmAction } from "@/components/craton-actions";

export default function OrgTeamsPage({
  params,
}: {
  params: Promise<{ org: string }>;
}) {
  const { org } = use(params);

  const [teams, setTeams] = useState([
    {
      id: "core-engineers",
      name: "Core Hydraulic Engineers",
      description: "Primary modelers maintaining the river basin 2D mesh calibrations.",
      members: 4,
      repos: 6,
    },
    {
      id: "gis-surveyors",
      name: "GIS & Survey Team",
      description: "Field surveyors capturing cross-sections, LiDAR, and bathymetry.",
      members: 3,
      repos: 4,
    },
    {
      id: "external-reviewers",
      name: "External Reviewers",
      description: "Consultancy and academic auditors with read-only access to proofs.",
      members: 5,
      repos: 2,
    },
  ]);

  const [search, setSearch] = useState("");
  const [createModal, setCreateModal] = useState(false);
  const [teamName, setTeamName] = useState("");
  const [teamDesc, setTeamDesc] = useState("");

  const filteredTeams = teams.filter((t) =>
    t.name.toLowerCase().includes(search.toLowerCase())
  );

  function handleCreateTeam(e: React.FormEvent) {
    e.preventDefault();
    if (!teamName.trim()) return;

    setTeams([
      ...teams,
      {
        id: teamName.toLowerCase().replace(/\s+/g, "-"),
        name: teamName.trim(),
        description: teamDesc.trim() || "No description provided.",
        members: 1,
        repos: 0,
      },
    ]);
    toast.success(`Team "${teamName}" created!`);
    setTeamName("");
    setTeamDesc("");
    setCreateModal(false);
  }

  function handleDeleteTeam(id: string) {
    const removed = teams.find((t) => t.id === id);
    setTeams((all) => all.filter((t) => t.id !== id));
    toast.success(`Deleted ${removed?.name ?? "team"}`, {
      action: removed ? { label: "Undo", onClick: () => setTeams((all) => [...all, removed]) } : undefined,
    });
  }

  return (
    <AppShell>
      <OrgHeader org={org} />
      <div className="w-full px-4 sm:px-6 lg:px-8 xl:px-10 py-6 max-w-6xl mx-auto">
        <div className="flex flex-wrap items-center justify-between gap-4 pb-6">
          <div className="relative w-full max-w-sm">
            <Search className="absolute left-2.5 top-2.5 size-3.5 text-muted-foreground" />
            <Input
              placeholder="Find a team..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 text-xs h-9"
            />
          </div>

          <Button size="sm" onClick={() => setCreateModal(!createModal)} className="gap-1.5">
            <Plus className="size-3.5" /> New team
          </Button>
        </div>

        {createModal && (
          <Card className="mb-6 p-5 border-primary/50 bg-primary/5">
            <form onSubmit={handleCreateTeam} className="flex flex-col gap-3 max-w-md">
              <h2 className="text-sm font-semibold">Create a new team</h2>
              <Input
                placeholder="Team name: e.g. Hydrologic Modeler Group"
                value={teamName}
                onChange={(e) => setTeamName(e.target.value)}
                className="text-xs h-9 bg-background"
                required
              />
              <Input
                placeholder="Description (optional)"
                value={teamDesc}
                onChange={(e) => setTeamDesc(e.target.value)}
                className="text-xs h-9 bg-background"
              />
              <div className="flex gap-2 pt-1">
                <Button type="submit" size="sm">
                  Create team
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => setCreateModal(false)}>
                  Cancel
                </Button>
              </div>
            </form>
          </Card>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filteredTeams.map((t) => (
            <Card key={t.id} className="flex flex-col justify-between p-5 hover:border-primary/40 transition-colors">
              <div>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <UsersRound className="size-4 text-accent" />
                    <h2 className="font-semibold text-sm">{t.name}</h2>
                  </div>
                  <ConfirmAction
                    trigger={
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="text-muted-foreground hover:text-destructive -mr-2 -mt-1"
                        aria-label={`Delete team ${t.name}`}
                        title="Delete team"
                      >
                        <Trash2 />
                      </Button>
                    }
                    title={`Delete ${t.name}?`}
                    description="Members keep their organization membership but lose the repository access this team gave them."
                    confirmLabel="Delete team"
                    onConfirm={() => handleDeleteTeam(t.id)}
                  />
                </div>
                <p className="text-xs text-muted-foreground mt-2 line-clamp-2 leading-relaxed">
                  {t.description}
                </p>
              </div>

              <div className="flex items-center justify-between text-xs text-muted-foreground pt-4 border-t border-border mt-4">
                <span>{t.members} members</span>
                <span className="flex items-center gap-1">
                  <FolderGit2 className="size-3" /> {t.repos} repos
                </span>
              </div>
            </Card>
          ))}
        </div>
      </div>
    </AppShell>
  );
}
