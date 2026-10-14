"use client";

import { use, useState } from "react";
import Link from "next/link";
import { BookOpen, FolderGit2, Star, Users } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

export default function UserFollowingPage({
  params,
}: {
  params: Promise<{ owner: string }>;
}) {
  const { owner } = use(params);

  const [followingList, setFollowingList] = useState([
    { handle: "openterrain", name: "OpenTerrain Global", bio: "Global terrain elevation tiles and point clouds as open Cloud-Optimized GeoTIFFs.", following: true },
    { handle: "deltares", name: "Deltares Research", bio: "Applied research institute for water and subsurface.", following: true },
    { handle: "usgs-water", name: "USGS Water Resources", bio: "Water resources mission area of the U.S. Geological Survey.", following: true },
  ]);

  function toggleFollow(handle: string) {
    setFollowingList(
      followingList.map((f) => {
        if (f.handle === handle) {
          const next = !f.following;
          toast.success(next ? `Following ${handle}` : `Unfollowed ${handle}`);
          return { ...f, following: next };
        }
        return f;
      })
    );
  }

  return (
    <AppShell>
      {/* Top GitHub-style Profile Tabs */}
      <div className="w-full border-b border-border bg-card/30">
        <div className="w-full px-4 sm:px-6 lg:px-8 xl:px-10 flex gap-2 overflow-x-auto">
          <Link
            href={`/${owner}`}
            className="flex items-center gap-2 border-b-2 border-transparent px-3 py-3 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            <BookOpen className="size-4" /> Overview
          </Link>
          <Link
            href={`/${owner}?tab=repositories`}
            className="flex items-center gap-2 border-b-2 border-transparent px-3 py-3 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            <FolderGit2 className="size-4" /> Repositories
          </Link>
          <Link
            href={`/${owner}/stars`}
            className="flex items-center gap-2 border-b-2 border-transparent px-3 py-3 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            <Star className="size-4" /> Stars
          </Link>
          <Link
            href={`/${owner}/followers`}
            className="flex items-center gap-2 border-b-2 border-transparent px-3 py-3 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            <Users className="size-4" /> Followers
          </Link>
          <Link
            href={`/${owner}/following`}
            className="flex items-center gap-2 border-b-2 border-accent px-3 py-3 text-sm font-semibold text-foreground transition-colors"
          >
            <Users className="size-4" /> Following
            <Badge variant="secondary" className="ml-1 text-xs">
              {followingList.length}
            </Badge>
          </Link>
        </div>
      </div>

      <div className="w-full px-4 sm:px-6 lg:px-8 xl:px-10 py-6 max-w-4xl mx-auto">
        <h1 className="text-xl font-semibold mb-4">Following</h1>
        <Card className="overflow-hidden py-0">
          <ul className="divide-y divide-border">
            {followingList.map((f) => (
              <li key={f.handle} className="flex items-center justify-between p-4 hover:bg-muted/20">
                <div className="flex items-center gap-3">
                  <Avatar className="size-10">
                    <AvatarFallback className="text-xs font-semibold">
                      {f.handle.slice(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <div className="flex items-center gap-2">
                      <Link href={`/${f.handle}`} className="font-semibold text-sm hover:underline">
                        {f.name}
                      </Link>
                      <span className="text-xs text-muted-foreground font-mono">@{f.handle}</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5 max-w-md">{f.bio}</p>
                  </div>
                </div>

                <Button
                  variant="outline"
                  aria-pressed={f.following}
                  size="sm"
                  onClick={() => toggleFollow(f.handle)}
                  className="w-24 text-xs"
                >
                  {f.following ? "Following" : "Follow"}
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </AppShell>
  );
}
