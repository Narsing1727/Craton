"use client";

import { useState } from "react";
import Link from "next/link";
import {
  MapPin,
  LinkIcon,
  Building2,
  Calendar,
  Users,
  BookMarked,
  Star,
  Search,
  BookOpen,
  FolderGit2,
  Lock,
  Radio,
  Layers,
  ShieldCheck,
  Share2,
  Heart,
  HardDrive,
  GitCommit,
  CheckCircle2,
  Flame,
  Activity,
  Compass,
  FileCode2,
  ExternalLink,
} from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { RepoCard } from "@/components/repo-card";
import { DataTypeBadge } from "@/components/data-type-badge";
import { StatGrid, StatTile } from "@/components/craton-ui";
import type { Activity as FeedItem, Repo } from "@/lib/data";
import type { Activity as Day } from "@/components/contribution-graph";
import { cn } from "@/lib/utils";
import { notify } from "@/components/button-status";
import {
  GitHubContributions,
  GitHubContributionsFallback,
} from "@/components/github-contributions";

export type Profile = {
  handle: string;
  name: string;
  bio: string;
  headline?: string;
  org?: string;
  orgs: string[];
  location?: string;
  memberSince: string;
};

export type ProfileStats = { stored: string; storedHint: string; commits: string; commitsHint: string; network: string; networkHint: string };

export function ProfileView({
  profile,
  repos: ownerRepos,
  activity,
  contributions,
  stats,
  live,
}: {
  profile: Profile;
  repos: Repo[];
  activity: FeedItem[];
  contributions: Day[];
  stats: ProfileStats;
  live: boolean;
}) {
  const owner = profile.handle;
  const [activeTab, setActiveTab] = useState<"overview" | "repositories" | "calibrations">("overview");
  const [following, setFollowing] = useState(false);
  const [repoSearch, setRepoSearch] = useState("");
  const [tagFilter, setTagFilter] = useState("all");

  const displayedRepos = ownerRepos;
  const toolchain = live ? [...new Set(ownerRepos.flatMap((r) => r.tags))] : ["HEC-RAS 6.5", "EPA SWMM 5.2", "COG / Cloud GeoTIFF", "QGIS 3.34", "GDAL / OGR", "Python / FloPy", "LiDAR LAS/LAZ"];

  const filteredRepos = displayedRepos.filter((r) => {
    const matchesSearch =
      r.name.toLowerCase().includes(repoSearch.toLowerCase()) ||
      r.description.toLowerCase().includes(repoSearch.toLowerCase());
    const matchesTag = tagFilter === "all" || r.tags.includes(tagFilter as any);
    return matchesSearch && matchesTag;
  });

  function toggleFollow() {
    setFollowing(!following);
    notify.success(following ? `Unfollowed ${owner}` : `Following ${owner}`, {
      description: "You will receive updates on dataset revisions and model tags.",
    });
  }

  function handleShare() {
    if (typeof window !== "undefined") {
      navigator.clipboard?.writeText(window.location.href);
      notify.success("Profile URL copied to clipboard");
    }
  }

  return (
    <AppShell>
      {/* Station Banner Header */}
      <section className="w-full border-b border-border bg-card/30">
        <div className="w-full px-4 sm:px-6 lg:px-8 xl:px-10 py-6">
          {/* Profile Identity Bar */}
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
            <div className="flex items-start sm:items-center gap-5">
              <div className="relative">
                <Avatar className="size-20 sm:size-24 rounded-2xl border-2 border-border shadow-lg bg-card ring-4 ring-background">
                  <AvatarFallback className="text-2xl sm:text-3xl font-bold bg-muted text-foreground">
                    {owner.slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <span className="absolute -bottom-1 -right-1 flex size-5 items-center justify-center rounded-full bg-foreground text-[10px] font-bold text-background ring-2 ring-background">
                  ✓
                </span>
              </div>

              <div className="flex flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2.5">
                  <h1 className="text-2xl font-bold tracking-tight">{profile.name}</h1>
                  <span className="font-mono text-xs text-muted-foreground bg-muted/60 border border-border/40 px-2 py-0.5 rounded-md">
                    @{owner}
                  </span>
                  {profile.headline && (
                    <Badge variant="secondary" className="text-[11px] font-normal border-border bg-muted/30 text-foreground">
                      {profile.headline}
                    </Badge>
                  )}
                </div>
                {profile.bio && <p className="text-sm text-muted-foreground max-w-2xl leading-relaxed">{profile.bio}</p>}
                <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground pt-1">
                  {profile.org && (
                    <>
                      <Link href={`/orgs/${profile.org}`} className="flex items-center gap-1 text-foreground hover:underline">
                        <Building2 className="size-3.5 text-muted-foreground" /> {profile.org}
                      </Link>
                      <span>•</span>
                    </>
                  )}
                  {profile.location && (
                    <>
                      <span className="flex items-center gap-1">
                        <MapPin className="size-3.5 text-muted-foreground" /> {profile.location}
                      </span>
                      <span>•</span>
                    </>
                  )}
                  <span className="flex items-center gap-1">
                    <Calendar className="size-3.5 text-muted-foreground" /> Member since {profile.memberSince}
                  </span>
                </div>
              </div>
            </div>

            {/* Header Action Buttons (Black and White) */}
            <div className="flex items-center gap-2 self-stretch md:self-auto shrink-0">
              {!live && (
                <Button
                  variant={following ? "secondary" : "default"}
                  size="sm"
                  onClick={toggleFollow}
                  className="flex-1 md:flex-initial"
                >
                  {following ? "Following" : "Follow"}
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={handleShare}
                title="Share profile link"
              >
                <Share2 className="size-3.5 text-foreground" />
                <span className="hidden sm:inline">Share</span>
              </Button>
              {!live && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => notify.info("Hydrolab open dataset sponsorship", { description: "Community funding goes directly to cloud hosting for 2m elevation models." })}
                  title="Sponsor research datasets"
                >
                  <Heart className="size-3.5 text-foreground" />
                  <span className="hidden sm:inline">Sponsor</span>
                </Button>
              )}
            </div>
          </div>

          {/* Quick stats */}
          <StatGrid className="mt-6">
            <StatTile label={live ? "Data in repositories" : "Data stored"} value={stats.stored} hint={stats.storedHint} />
            <StatTile label="Repositories" value={displayedRepos.length} hint={live ? toolchain.slice(0, 3).join(", ") || "No data yet" : "HEC-RAS, SWMM and terrain"} />
            <StatTile label="Commits" value={stats.commits} hint={stats.commitsHint} />
            <StatTile label={live ? "Organizations" : "Network"} value={stats.network} hint={stats.networkHint} />
          </StatGrid>
        </div>

        {/* Tab Controls Bar */}
        <div className="w-full px-4 sm:px-6 lg:px-8 xl:px-10 flex gap-1 overflow-x-auto border-t border-border/30">
          <button
            onClick={() => setActiveTab("overview")}
            className={cn(
              "flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium transition-colors cursor-pointer",
              activeTab === "overview"
                ? "border-foreground text-foreground font-semibold"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            <Compass className="size-4 text-foreground" />
            Overview
          </button>
          <button
            onClick={() => setActiveTab("repositories")}
            className={cn(
              "flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium transition-colors cursor-pointer",
              activeTab === "repositories"
                ? "border-foreground text-foreground font-semibold"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            <FolderGit2 className="size-4 text-foreground" />
            Repositories
            <Badge variant="secondary" className="ml-1 text-[11px]">
              {displayedRepos.length}
            </Badge>
          </button>
          <button
            onClick={() => setActiveTab("calibrations")}
            className={cn(
              "flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium transition-colors cursor-pointer",
              activeTab === "calibrations"
                ? "border-foreground text-foreground font-semibold"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            <Activity className="size-4 text-foreground" />
            Activity
            <Badge variant="secondary" className="ml-1 text-[11px]">
              {live ? activity.length : 128}
            </Badge>
          </button>
          <Link
            href={`/${owner}/stars`}
            className="flex items-center gap-2 border-b-2 border-transparent px-4 py-3 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            <Star className="size-4 text-foreground" />
            Stars
            {!live && (
              <Badge variant="secondary" className="ml-1 text-[11px]">
                12
              </Badge>
            )}
          </Link>
          {!live && (
            <Link
              href={`/${owner}/followers`}
              className="flex items-center gap-2 border-b-2 border-transparent px-4 py-3 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              <Users className="size-4 text-foreground" />
              Followers
              <Badge variant="secondary" className="ml-1 text-[11px]">
                128
              </Badge>
            </Link>
          )}
        </div>
      </section>

      {/* Main Content Layout */}
      <div className="grid grid-cols-1 w-full gap-8 px-4 sm:px-6 lg:px-8 xl:px-10 py-8 lg:grid-cols-[290px_1fr]">
        {/* Left Column: Engineer Specs & Credentials */}
        <aside className="flex flex-col gap-5">
          {/* Details Card */}
          {live ? (
            <Card className="p-4 border-border/40">
              <h2 className="text-sm font-semibold mb-3 flex items-center gap-1.5">
                <Compass className="size-3.5 text-foreground" /> Details
              </h2>
              <div className="flex flex-col gap-2.5 text-xs text-muted-foreground">
                <div className="flex items-center justify-between gap-3 pb-2 border-b border-border/20">
                  <span className="flex items-center gap-1.5 text-foreground">
                    <Building2 className="size-3.5 text-foreground" /> Organizations
                  </span>
                  <span className="flex flex-wrap justify-end gap-1.5 font-mono text-foreground">
                    {profile.orgs.length === 0 && <span className="text-muted-foreground">None</span>}
                    {profile.orgs.map((o) => (
                      <Link key={o} href={`/orgs/${o}`} className="hover:underline">
                        {o}
                      </Link>
                    ))}
                  </span>
                </div>
                <div className="flex items-center justify-between pb-2 border-b border-border/20">
                  <span className="flex items-center gap-1.5 text-foreground">
                    <Calendar className="size-3.5 text-foreground" /> Member since
                  </span>
                  <span>{profile.memberSince}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-foreground">
                    <FolderGit2 className="size-3.5 text-foreground" /> Repositories
                  </span>
                  <span className="font-mono text-foreground">{displayedRepos.length}</span>
                </div>
              </div>
            </Card>
          ) : (
          <Card className="p-4 border-border/40">
            <h2 className="text-sm font-semibold mb-3 flex items-center gap-1.5">
              <Compass className="size-3.5 text-foreground" /> Details
            </h2>
            <div className="flex flex-col gap-2.5 text-xs text-muted-foreground">
              <div className="flex items-center justify-between pb-2 border-b border-border/20">
                <span className="flex items-center gap-1.5 text-foreground">
                  <Building2 className="size-3.5 text-foreground" /> Laboratory
                </span>
                <span className="font-mono text-foreground font-medium">hydrolab</span>
              </div>
              <div className="flex items-center justify-between pb-2 border-b border-border/20">
                <span className="flex items-center gap-1.5 text-foreground">
                  <MapPin className="size-3.5 text-foreground" /> Basin Zone
                </span>
                <span>Western Ghats Reach</span>
              </div>
              <div className="flex items-center justify-between pb-2 border-b border-border/20">
                <span className="flex items-center gap-1.5 text-foreground">
                  <Layers className="size-3.5 text-foreground" /> Spatial Datum
                </span>
                <span className="font-mono text-foreground">WGS 84 / UTM 43N</span>
              </div>
              <div className="flex items-center justify-between pb-2 border-b border-border/20">
                <span className="flex items-center gap-1.5 text-foreground">
                  <LinkIcon className="size-3.5 text-foreground" /> Website
                </span>
                <a
                  href="https://hydrolab.org"
                  target="_blank"
                  rel="noreferrer"
                  className="text-foreground hover:underline flex items-center gap-1 font-mono"
                >
                  hydrolab.org <ExternalLink className="size-2.5" />
                </a>
              </div>
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-foreground">
                  <ShieldCheck className="size-3.5 text-foreground" /> Signed Key
                </span>
                <span className="font-mono text-[10px] text-foreground bg-muted/30 px-1.5 py-0.5 rounded border border-border">
                  4A8F•••92B1
                </span>
              </div>
            </div>
          </Card>
          )}

          {/* Model Toolchain Badges - 100% Pure Black and White */}
          <Card className="p-4 border-border/40">
            <h2 className="text-sm font-semibold mb-3 flex items-center gap-1.5">
              <FileCode2 className="size-3.5 text-foreground" /> {live ? "Data types" : "Toolchain"}
            </h2>
            <div className="flex flex-wrap gap-1.5">
              {live && toolchain.length === 0 && <span className="text-xs text-muted-foreground">No data yet.</span>}
              {toolchain.map((tool) => (
                <Badge
                  key={tool}
                  variant="outline"
                  className="text-xs py-1 px-2 border-border bg-muted/20 text-foreground font-mono hover:bg-muted/40 transition-colors"
                >
                  {tool}
                </Badge>
              ))}
            </div>
          </Card>

          {/* Collaborator Network Mini-Card */}
          {!live && (
          <Card className="p-4 border-border/40">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold flex items-center gap-1.5">
                <Users className="size-3.5 text-foreground" /> Network
              </h2>
              <Link href={`/${owner}/followers`} className="text-[11px] text-foreground hover:underline">
                View all
              </Link>
            </div>
            <div className="flex items-center gap-4 text-xs pb-3 border-b border-border/20">
              <Link href={`/${owner}/followers`} className="flex items-center gap-1.5 hover:text-foreground transition-colors">
                <Users className="size-3.5 text-muted-foreground" />
                <strong className="text-foreground">128</strong>
                <span className="text-muted-foreground">followers</span>
              </Link>
              <span>•</span>
              <Link href={`/${owner}/following`} className="flex items-center gap-1.5 hover:text-foreground transition-colors">
                <strong className="text-foreground">24</strong>
                <span className="text-muted-foreground">following</span>
              </Link>
            </div>
            <div className="pt-3">
              <p className="text-[11px] text-muted-foreground leading-normal">
                Collaborating on Western Ghats river basin resilience with Central Water Commission partners.
              </p>
            </div>
          </Card>
          )}
        </aside>

        {/* Right Column: Tab View Contents */}
        <div className="flex flex-col gap-6">
          {activeTab === "overview" && (
            <>
              {/* Spatial Activity Matrix */}
              <Card className="overflow-hidden border-border/40 w-full">
                <CardHeader className="pb-3 border-b border-border/30 bg-muted/20">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <CardTitle className="text-sm font-semibold flex items-center gap-2">
                        <Activity className="size-4 text-foreground" />
                        Activity
                      </CardTitle>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Commits, reviews and releases over the last year
                      </p>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="pt-3 pb-3 px-3 sm:px-4 w-full">
                  {/* Local, synchronous data: renders immediately with no spinner. */}
                  <GitHubContributions contributions={contributions} className="w-full" />
                </CardContent>
              </Card>

              {/* Showcased Basin Repositories */}
              <div>
                <div className="flex items-center justify-between mb-3.5">
                  <div className="flex items-center gap-2">
                    <h2 className="text-base font-semibold">{live ? "Repositories" : "Featured Basins & Models"}</h2>
                    <Badge variant="outline" className="text-xs font-mono">
                      {displayedRepos.length} active
                    </Badge>
                  </div>
                  <Button size="sm" variant="outline" href="/new">
                    + New repository
                  </Button>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {displayedRepos.map((r) => (
                    <div
                      key={`${r.owner}/${r.name}`}
                      className="group flex flex-col justify-between rounded-lg border border-border/40 bg-card/60 p-4 transition-all hover:border-border hover:bg-muted/15"
                    >
                      <div className="flex flex-col gap-2">
                        <div className="flex items-start justify-between gap-2">
                          {/* Low Frequency: Crisp Blue Link Color as shown in user's image */}
                          <Link
                            href={`/${r.owner}/${r.name}`}
                            className="font-semibold text-blue-500 hover:text-blue-400 hover:underline transition-colors"
                          >
                            {r.name}
                          </Link>
                          <Badge variant="outline" className="text-[10px] capitalize font-mono">
                            {r.visibility}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
                          {r.description}
                        </p>
                        <div className="flex flex-wrap gap-1.5 pt-1">
                          {r.tags.map((t) => (
                            <DataTypeBadge key={t} type={t} />
                          ))}
                        </div>
                      </div>

                      <div className="mt-4 flex items-center justify-between pt-3 border-t border-border/20 text-xs text-muted-foreground font-mono">
                        <div className="flex items-center gap-3">
                          <span className="flex items-center gap-1">
                            <Star className="size-3 text-muted-foreground" />
                            {r.stars}
                          </span>
                          <span>{r.size}</span>
                        </div>
                        <Link
                          href={`/${r.owner}/${r.name}/compare`}
                          className="text-[11px] text-muted-foreground hover:text-foreground hover:underline flex items-center gap-1 font-mono"
                        >
                          Compare →
                        </Link>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Hydro Engineering Audit & Field Log */}
              <div>
                <h2 className="text-base font-semibold mb-3">{live ? "Recent activity" : "Recent Model Calibration Milestones"}</h2>
                <Card className="overflow-hidden py-0 border-border/40">
                  <ul className="divide-y divide-border/40 text-xs">
                    {live && activity.length === 0 && <li className="p-3.5 text-muted-foreground">No activity yet.</li>}
                    {activity.slice(0, live ? 6 : 4).map((a, i) => (
                      <li key={i} className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3.5 hover:bg-muted/20 transition-colors">
                        <div className="flex items-center gap-2.5">
                          <div className="size-2 rounded-full bg-foreground" />
                          <span className="font-semibold text-foreground">{a.actor}</span>
                          {a.href ? (
                            <Link href={a.href} className="text-muted-foreground hover:text-foreground hover:underline">
                              {a.text}
                            </Link>
                          ) : (
                            <span className="text-muted-foreground">{a.text}</span>
                          )}
                          {/* Low Frequency: Crisp Blue Link Color as shown in user's image */}
                          <Link href={`/${a.repo}`} className="font-semibold text-blue-500 hover:text-blue-400 hover:underline font-mono">
                            {a.repo}
                          </Link>
                        </div>
                        <div className="flex items-center gap-3 text-muted-foreground sm:self-auto font-mono text-[11px]">
                          <Badge variant="outline" className="text-[10px] font-mono">
                            {live ? a.type : "Merkle certified"}
                          </Badge>
                          <span>{a.time}</span>
                        </div>
                      </li>
                    ))}
                  </ul>
                </Card>
              </div>
            </>
          )}

          {activeTab === "repositories" && (
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-border">
                <div className="relative w-full sm:w-72">
                  <Search className="absolute left-2.5 top-2.5 size-3.5 text-muted-foreground" />
                  <Input
                    placeholder="Filter repositories or basin models..."
                    value={repoSearch}
                    onChange={(e) => setRepoSearch(e.target.value)}
                    className="pl-8 text-xs h-9 bg-card border-border/40"
                  />
                </div>

                <div className="flex items-center gap-2">
                  <Select value={tagFilter} onValueChange={setTagFilter}>
                    <SelectTrigger className="w-36 h-9 text-xs">
                      <SelectValue placeholder="Data format" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All formats</SelectItem>
                      <SelectItem value="DEM">DEM (COG)</SelectItem>
                      <SelectItem value="HEC-RAS">HEC-RAS (2D)</SelectItem>
                      <SelectItem value="Shapefile">Shapefile / GeoPackage</SelectItem>
                      <SelectItem value="LiDAR">LiDAR (LAS/LAZ)</SelectItem>
                      <SelectItem value="NetCDF">NetCDF Model Grid</SelectItem>
                    </SelectContent>
                  </Select>

                  <Button size="sm" href="/new">
                    New repository
                  </Button>
                </div>
              </div>

              {/* Repositories List */}
              <div className="grid gap-0 divide-y divide-border/20 border border-border/20 rounded-lg overflow-hidden bg-card/40">
                {filteredRepos.length > 0 ? (
                  filteredRepos.map((r) => (
                    <RepoCard key={`${r.owner}/${r.name}`} repo={r} />
                  ))
                ) : (
                  <div className="p-8 text-center text-sm text-muted-foreground">
                    No repositories match your filter query.
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === "calibrations" && live && (
            <Card className="overflow-hidden py-0 border-border/40">
              <ul className="divide-y divide-border/40 text-xs">
                {activity.length === 0 && <li className="p-3.5 text-muted-foreground">No activity yet.</li>}
                {activity.map((a, i) => (
                  <li key={i} className="flex flex-col gap-1 p-3.5 sm:flex-row sm:items-center sm:justify-between">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <span className="font-semibold text-foreground">{a.actor}</span>
                      <Link href={a.href ?? `/${a.repo}`} className="text-muted-foreground hover:text-foreground hover:underline">
                        {a.text}
                      </Link>
                      <Link href={`/${a.repo}`} className="font-mono font-semibold text-blue-500 hover:text-blue-400 hover:underline">
                        {a.repo}
                      </Link>
                      {a.detail && <span className="truncate text-muted-foreground">· {a.detail}</span>}
                    </span>
                    <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{a.time}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {activeTab === "calibrations" && !live && (
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between border-b border-border pb-3">
                <div>
                  <h3 className="text-base font-semibold">2D Hydraulic Calibration Logs</h3>
                  <p className="text-xs text-muted-foreground">
                    Merkle verification logs and Manning roughness calibration runs for Kerala basins
                  </p>
                </div>
                <Button size="sm" variant="outline" href="/hydrolab/chalakudy-basin/compare">
                  Open latest diff
                </Button>
              </div>

              <div className="space-y-3">
                <Card className="p-4 border-l-4 border-l-border bg-card/60">
                  <div className="flex items-center justify-between text-xs text-muted-foreground font-mono">
                    <span className="text-foreground font-semibold">RUN #2024-MONSOON-CAL-04</span>
                    <span>3 hours ago</span>
                  </div>
                  <h3 className="text-sm font-semibold mt-1">Recalibrate Manning&apos;s n for Chalakudy Upper Reach</h3>
                  <p className="text-xs text-muted-foreground mt-1">
                    Updated channel roughness from 0.035 to 0.038 based on gauge readings at Vettilappara bridge. RMSE reduced by 14.2%.
                  </p>
                  <div className="mt-3 flex items-center gap-2">
                    <Badge variant="outline" className="text-[10px]">HEC-RAS 6.5</Badge>
                    <Badge variant="outline" className="text-[10px] font-mono">Merkle: a1b2c3d</Badge>
                    <Badge variant="secondary" className="text-[10px]">PASSED 100-yr QA</Badge>
                  </div>
                </Card>

                <Card className="p-4 border-l-4 border-l-border bg-card/60">
                  <div className="flex items-center justify-between text-xs text-muted-foreground font-mono">
                    <span className="text-foreground font-semibold">RUN #2024-DEM-TILES-02</span>
                    <span>2 days ago</span>
                  </div>
                  <h3 className="text-sm font-semibold mt-1">Re-tile 2m Terrain DEM to Cloud-Optimized GeoTIFF</h3>
                  <p className="text-xs text-muted-foreground mt-1">
                    Constructed internal pyramidal overviews (256x256). Ingested 2.8 GB raster layer with LZW compression.
                  </p>
                  <div className="mt-3 flex items-center gap-2">
                    <Badge variant="outline" className="text-[10px]">DEM</Badge>
                    <Badge variant="outline" className="text-[10px] font-mono">EPSG:32643</Badge>
                    <Badge variant="secondary" className="text-[10px]">OPTIMIZED COG</Badge>
                  </div>
                </Card>

                <Card className="p-4 border-l-4 border-l-border bg-card/60">
                  <div className="flex items-center justify-between text-xs text-muted-foreground font-mono">
                    <span className="text-foreground font-semibold">RUN #2024-VEC-BOUND-01</span>
                    <span>4 days ago</span>
                  </div>
                  <h3 className="text-sm font-semibold mt-1">Catchment boundary topology fix &amp; gauging station coordinates</h3>
                  <p className="text-xs text-muted-foreground mt-1">
                    Resolved self-intersections in sub-basin polygons. Added 12 telemetry sensors with hourly stage data.
                  </p>
                  <div className="mt-3 flex items-center gap-2">
                    <Badge variant="outline" className="text-[10px]">Shapefile</Badge>
                    <Badge variant="outline" className="text-[10px] font-mono">GeoJSON</Badge>
                    <Badge variant="secondary" className="text-[10px]">TOPOLOGY VERIFIED</Badge>
                  </div>
                </Card>
              </div>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
