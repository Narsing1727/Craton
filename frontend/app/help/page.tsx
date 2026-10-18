"use client";

import { useState } from "react";
import Link from "next/link";
import {
  HelpCircle,
  Search,
  BookOpen,
  Terminal,
  FolderGit2,
  Users,
  MessageCircle,
  FileQuestion,
} from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const categories = [
  {
    icon: Terminal,
    title: "Craton CLI & Auth",
    desc: "Installing the CLI and signing it in with a personal access token.",
    link: "/cli",
  },
  {
    icon: FolderGit2,
    title: "Repositories & Data",
    desc: "Pushing large DEMs, tracking shapefile sets, and reading storage and map previews.",
    link: "/new",
  },
  {
    icon: BookOpen,
    title: "Pull Requests & Diffs",
    desc: "Comparing hydraulic models, reviewing spatial vector changes, and merging branches.",
    link: "/explore",
  },
  {
    icon: Users,
    title: "Organizations",
    desc: "Creating an organization and managing its members’ roles.",
    link: "/orgs/new",
  },
];

const faqs = [
  {
    q: "How does Craton handle multi-gigabyte DEM and LiDAR files?",
    a: "The CLI splits each file into content-defined chunks and uploads only the chunks the server doesn’t already have. A re-surveyed DEM sends the tiles that changed, and base data already published publicly (such as SRTM tiles) isn’t stored or counted twice.",
  },
  {
    q: "Can I use git with Craton repositories?",
    a: "No. Craton has its own CLI (craton clone, add, commit, push, pull) because git isn’t built for files this size. The commands follow git’s names, so they feel familiar.",
  },
  {
    q: "What does a pull request show for GIS files?",
    a: "For GeoTIFFs, a map of where the elevation changed and by how much; for shapefiles, which features were added, changed or removed; for everything, which chunks are new. Checks for CRS, vertical datum and nodata run on every push.",
  },
  {
    q: "Can I work with people from other firms or agencies?",
    a: "Yes. Create an organization and add them as Owner, Maintainer or Member. They need a Craton account and a confirmed email first.",
  },
];

export default function HelpPage() {
  const [search, setSearch] = useState("");

  return (
    <AppShell>
      {/* Banner */}
      <div className="w-full border-b border-border/40 bg-card/30 py-12 px-4 sm:px-6 lg:px-8 xl:px-10 text-center">
        <div className="max-w-2xl mx-auto">
          <div className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs text-primary mb-3">
            <HelpCircle className="size-3.5" /> Help &amp; Support Center
          </div>
          <h1 className="text-3xl font-bold tracking-tight">How can we help you?</h1>
          <p className="text-sm text-muted-foreground mt-2">
            Search documentation, browse guides, or get in touch with our team.
          </p>

          <div className="relative mt-6 max-w-lg mx-auto">
            <Search className="absolute left-3 top-3 size-4 text-muted-foreground" aria-hidden />
            <Input
              aria-label="Search the help guides"
              placeholder="Search guides, FAQs and troubleshooting…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10 h-11 text-sm bg-background shadow-sm"
            />
          </div>
        </div>
      </div>

      <div className="w-full px-4 sm:px-6 lg:px-8 xl:px-10 py-10 max-w-5xl mx-auto flex flex-col gap-12">
        {/* Knowledge categories */}
        <div>
          <h2 className="text-base font-semibold mb-4">Browse by topic</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {categories.map((c) => (
              <Link
                key={c.title}
                href={c.link}
                className="group flex flex-col justify-between rounded-lg border border-border bg-card p-5 hover:border-primary/50 hover:bg-muted/20 transition-all"
              >
                <div>
                  <c.icon className="size-5 text-accent mb-3 group-hover:scale-110 transition-transform" />
                  <h3 className="font-semibold text-sm group-hover:text-primary transition-colors">
                    {c.title}
                  </h3>
                  <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">
                    {c.desc}
                  </p>
                </div>
                <span className="text-xs text-primary font-medium mt-4 inline-flex items-center gap-1">
                  Learn more &rarr;
                </span>
              </Link>
            ))}
          </div>
        </div>

        {/* FAQs */}
        <div>
          <h2 className="text-base font-semibold mb-4">Frequently Asked Questions</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {faqs.map((faq, i) => (
              <Card key={i} className="p-5">
                <div className="flex items-start gap-2.5">
                  <FileQuestion className="size-4 text-accent shrink-0 mt-0.5" />
                  <div>
                    <h3 className="font-semibold text-sm">{faq.q}</h3>
                    <p className="text-xs text-muted-foreground mt-2 leading-relaxed">
                      {faq.a}
                    </p>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </div>

        {/* Still stuck */}
        <Card className="p-6 bg-muted/20">
          <div className="mb-2 flex items-center gap-2">
            <MessageCircle className="size-5 text-muted-foreground" aria-hidden />
            <h2 className="text-lg font-semibold">Still have questions?</h2>
          </div>
          <p className="mb-4 text-sm text-muted-foreground">Write to the people who run Craton. Include your username and the repository if it’s about one.</p>
          <div>
            <Button href="/contact" variant="outline" size="sm">
              How to reach us
            </Button>
          </div>
        </Card>
      </div>
    </AppShell>
  );
}
