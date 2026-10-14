"use client";

import * as React from "react";
import Link from "next/link";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  ArrowUpRight,
  Boxes,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleDot,
  Code2,
  Copy,
  Database,
  Download,
  ExternalLink,
  Eye,
  FileCode,
  FileSpreadsheet,
  FileText,
  Filter,
  Flame,
  Folder,
  GitBranch,
  GitCommit,
  GitCompare,
  GitFork,
  GitPullRequest,
  HardDrive,
  History,
  Layers,
  Lock,
  Map as MapIcon,
  MessageSquare,
  Paperclip,
  Play,
  RotateCcw,
  Search,
  Send,
  Share2,
  ShieldCheck,
  Sparkles,
  Star,
  Tag,
  Terminal,
  TrendingDown,
  TrendingUp,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ChartContainer, type ChartConfig } from "@/components/ui/chart";
import { MapPreview, MapDiffLegend } from "@/components/map-preview";

// Hydro Storage and Dedup metrics over time
const dedupTrendData = [
  { month: "Jan", rawSize: 8.4, storedSize: 2.1 },
  { month: "Feb", rawSize: 12.8, storedSize: 2.8 },
  { month: "Mar", rawSize: 16.2, storedSize: 3.4 },
  { month: "Apr", rawSize: 18.9, storedSize: 3.9 },
  { month: "May", rawSize: 21.4, storedSize: 4.3 },
  { month: "Jun", rawSize: 22.6, storedSize: 4.8 },
];

const dedupChartConfig: ChartConfig = {
  rawSize: {
    label: "Raw Model Data (GB)",
    color: "var(--muted-foreground)",
  },
  storedSize: {
    label: "Stored on R2 (GB)",
    color: "var(--foreground)",
  },
};

// Hydro repo layers / files
const hydroFiles = [
  {
    name: "chalakudy_dem_1m.tif",
    type: "raster",
    format: "COG / LERC",
    size: "1.42 GB",
    stored: "148 MB",
    dedup: "89.6%",
    commit: "Re-tile to Cloud-Optimized GeoTIFF with lossless LERC",
    author: "priyam",
    time: "2h ago",
    badge: "DEM",
  },
  {
    name: "flood_mesh_2d.hdf",
    type: "model",
    format: "HEC-RAS 2D",
    size: "840 MB",
    stored: "182 MB",
    dedup: "78.3%",
    commit: "Update unsteady flow computation mesh for breach scenario",
    author: "arvind-k",
    time: "4h ago",
    badge: "HEC-RAS",
  },
  {
    name: "levee_alignment.shp",
    type: "vector",
    format: "FlatGeobuf",
    size: "14.2 MB",
    stored: "3.1 MB",
    dedup: "78.1%",
    commit: "Align left-bank flood protection crest to revised survey",
    author: "priyam",
    time: "6h ago",
    badge: "Vector",
  },
  {
    name: "periyar_catchment_lidar.copc.laz",
    type: "pointcloud",
    format: "COPC / LASzip",
    size: "3.85 GB",
    stored: "620 MB",
    dedup: "83.9%",
    commit: "Octree-chunked LiDAR point cloud lossless compression",
    author: "sarah-chen",
    time: "1d ago",
    badge: "LiDAR",
  },
  {
    name: "monsoon_rainfall_ensemble.zarr",
    type: "model",
    format: "Zarr / NetCDF",
    size: "2.10 GB",
    stored: "410 MB",
    dedup: "80.5%",
    commit: "Stochastic rainfall grid reanalysis (100-year return)",
    author: "arvind-k",
    time: "2d ago",
    badge: "NetCDF",
  },
  {
    name: "copernicus_dem_30m.tif",
    type: "raster",
    format: "Shared Base",
    size: "182 MB",
    stored: "0 MB",
    dedup: "100.0%",
    commit: "Global elevation base data deduplicated across users",
    author: "system",
    time: "4d ago",
    badge: "Base Data",
  },
];

export function CratonHydroWorkspace() {
  const [activeTab, setActiveTab] = React.useState<"code" | "diff" | "locus" | "storage">("code");
  const [selectedBranch, setSelectedBranch] = React.useState("main");
  const [copiedCli, setCopiedCli] = React.useState(false);
  const [peerComment, setPeerComment] = React.useState("");

  const [discussions, setDiscussions] = React.useState([
    {
      id: "1",
      author: "Dr. Arvind Kumar",
      initials: "AK",
      role: "Lead Hydraulic Modeler",
      time: "15 mins ago",
      text: "Ran the 2D unsteady flow engine on the new breach alignment. Peak water level at chainage 4+200 is down by 0.38m with the proposed detention levee.",
      badge: "HEC-RAS 2D Simulation",
      reaction: "✓ Verified 0 sinks",
    },
    {
      id: "2",
      author: "Priya Menon",
      initials: "PM",
      role: "GIS Engineer",
      time: "8 mins ago",
      text: "Pushed commit 7f9ac32 with the adjusted COG tile. Merkle root hash is updated and matches the LOCUS audit envelope.",
      attachment: "chalakudy_breach_v2_hydrograph.csv (1.2 MB)",
      badge: "Merkle Root 0x7f9a...c321",
      reaction: "Regulatory Proof OK",
    },
  ]);

  function handleSendDiscussion() {
    if (!peerComment.trim()) return;
    setDiscussions([
      ...discussions,
      {
        id: String(Date.now()),
        author: "Priya Menon",
        initials: "PM",
        role: "GIS Engineer",
        time: "Just now",
        text: peerComment,
        badge: "main",
        reaction: "LOCUS Tracked",
      },
    ]);
    setPeerComment("");
  }

  function handleCopyCLI() {
    navigator.clipboard?.writeText("craton push -m 'calibrated Manning n'");
    setCopiedCli(true);
    setTimeout(() => setCopiedCli(false), 2000);
  }

  return (
    <div className="w-full bg-background text-foreground">
      {/* Real Hydro Telemetry Ticker Bar */}
      <div className="grid grid-cols-2 gap-2 border-b border-border/20 px-4 py-2 font-mono text-xs md:grid-cols-4 md:px-6">
        <div className="flex items-center gap-2">
          <span className="bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">DEM</span>
          <span className="font-semibold text-foreground">COG / LERC</span>
          <span className="text-muted-foreground">0-error</span>
          <span className="flex items-center text-foreground font-medium">
            <TrendingUp className="mr-0.5 size-3" />
            84.2% Dedup
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">LIDAR</span>
          <span className="font-semibold text-foreground">COPC / LAZ</span>
          <span className="text-muted-foreground">12.4M pts</span>
          <span className="flex items-center text-foreground font-medium">
            <ShieldCheck className="mr-0.5 size-3" />
            Bit-Identical
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">MODEL</span>
          <span className="font-semibold text-foreground">HEC-RAS 2D</span>
          <span className="text-muted-foreground">22.6 GB Study</span>
          <span className="flex items-center text-foreground font-medium">
            <CheckCircle2 className="mr-0.5 size-3" />
            Sync OK
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">LOCUS</span>
          <span className="font-semibold text-foreground">NEROLITH AUDIT</span>
          <span className="text-muted-foreground">0x7f9a...c321</span>
          <span className="flex items-center text-accent">
            <Check className="mr-0.5 size-3" />
            Certified
          </span>
        </div>
      </div>

      {/* GitHub Repository Header for Hydro Engineers */}
      <div className="w-full border-b border-border/20 py-4">
        <div className="flex w-full flex-wrap items-center justify-between gap-4 px-4 sm:px-6 lg:px-8 xl:px-10">
          <div className="flex flex-wrap items-center gap-2 font-mono text-base">
            <Link href="/dashboard" className="text-muted-foreground hover:text-foreground">
              hydrolab
            </Link>
            <span className="text-muted-foreground">/</span>
            <Link href="/" className="font-semibold text-foreground hover:underline">
              chalakudy-basin
            </Link>
            <span className="border border-border/30 bg-muted/20 px-2 py-0.5 text-xs text-muted-foreground">
              Public
            </span>
            <span className="border border-border/30 bg-muted/20 px-2 py-0.5 text-xs text-accent">
              HEC-RAS 2D &middot; COG &middot; LiDAR
            </span>
          </div>

          <div className="flex items-center gap-2 text-xs">
            <Button variant="outline" size="sm" onClick={handleCopyCLI} className="font-mono">
              <Terminal className="mr-1.5 size-3.5" />
              {copiedCli ? "Copied: craton push" : "craton push"}
            </Button>
            <Button variant="outline" size="sm">
              <Star className="mr-1.5 size-3.5" />
              Star <span className="ml-1 text-muted-foreground">34</span>
            </Button>
            <Button variant="outline" size="sm">
              <GitFork className="mr-1.5 size-3.5" />
              Fork <span className="ml-1 text-muted-foreground">8</span>
            </Button>
          </div>
        </div>

        {/* GitHub-style Workbench Navigation Tabs */}
        <div className="mt-4 flex w-full items-center gap-1 border-b border-border/20 px-4 sm:px-6 lg:px-8 xl:px-10 text-xs font-medium overflow-x-auto">
          <button
            onClick={() => setActiveTab("code")}
            className={`flex items-center gap-2 border-b-2 px-4 py-2.5 transition-colors whitespace-nowrap ${
              activeTab === "code"
                ? "border-foreground text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <Code2 className="size-3.5" />
            Model Layers &amp; Files
            <span className="bg-muted px-1.5 py-0.2 text-[10px] text-muted-foreground">6</span>
          </button>

          <button
            onClick={() => setActiveTab("diff")}
            className={`flex items-center gap-2 border-b-2 px-4 py-2.5 transition-colors whitespace-nowrap ${
              activeTab === "diff"
                ? "border-foreground text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <GitCompare className="size-3.5" />
            Visual Map Diff
            <span className="bg-muted/40 text-foreground border border-border px-1.5 py-0.2 text-[10px] font-mono">
              320 tiles
            </span>
          </button>

          <button
            onClick={() => setActiveTab("locus")}
            className={`flex items-center gap-2 border-b-2 px-4 py-2.5 transition-colors whitespace-nowrap ${
              activeTab === "locus"
                ? "border-foreground text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <ShieldCheck className="size-3.5" />
            Nerolith LOCUS Audit Gate
            <span className="bg-accent/20 text-accent px-1.5 py-0.2 text-[10px]">Passed</span>
          </button>

          <button
            onClick={() => setActiveTab("storage")}
            className={`flex items-center gap-2 border-b-2 px-4 py-2.5 transition-colors whitespace-nowrap ${
              activeTab === "storage"
                ? "border-foreground text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <HardDrive className="size-3.5" />
            FastCDC &amp; R2 Storage
            <span className="bg-muted px-1.5 py-0.2 text-[10px] text-muted-foreground">78.8% saved</span>
          </button>
        </div>
      </div>

      {/* WORKBENCH BODY */}
      <div className="grid w-full grid-cols-1 gap-6 p-4 sm:p-6 lg:p-8 xl:p-10 lg:grid-cols-3 xl:grid-cols-4">
        {/* LEFT / MAIN COLUMN (2 cols on lg, 3 on xl) */}
        <div className="flex flex-col gap-6 lg:col-span-2 xl:col-span-3">
          {/* TAB 1: CODE / MODEL LAYERS */}
          {activeTab === "code" && (
            <div className="flex flex-col gap-4">
              {/* Branch selector & Commit bar */}
              <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
                <div className="flex items-center gap-2">
                  <Select value={selectedBranch} onValueChange={setSelectedBranch}>
                    <SelectTrigger className="h-8 px-2.5 font-mono text-xs">
                      <GitBranch className="mr-1.5 size-3.5 text-muted-foreground" />
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="main">main</SelectItem>
                      <SelectItem value="develop">develop</SelectItem>
                      <SelectItem value="levee-scenario">levee-scenario</SelectItem>
                      <SelectItem value="lidar-2024-update">lidar-2024-update</SelectItem>
                    </SelectContent>
                  </Select>
                  <span className="text-muted-foreground font-mono">4 branches &middot; 128 commits</span>
                </div>

                <div className="flex items-center gap-2">
                  <span className="font-mono text-muted-foreground">Latest commit:</span>
                  <span className="border border-border/30 bg-muted/20 px-2 py-0.5 font-mono text-[11px] text-foreground">
                    7f9ac32
                  </span>
                </div>
              </div>

              {/* Commit info bar */}
              <div className="flex flex-wrap items-center justify-between border border-border/20 bg-muted/10 p-3 text-xs">
                <div className="flex items-center gap-2">
                  <Avatar className="size-6">
                    <AvatarFallback className="text-[10px]">PM</AvatarFallback>
                  </Avatar>
                  <span className="font-semibold text-foreground">priyam</span>
                  <span className="text-muted-foreground">
                    Re-tile DEM to Cloud-Optimized GeoTIFF (lossless LERC)
                  </span>
                </div>
                <div className="flex items-center gap-3 font-mono text-muted-foreground text-[11px]">
                  <span>2 hours ago</span>
                  <span className="text-foreground font-medium">✓ LOCUS Gate Passed</span>
                </div>
              </div>

              {/* Hydro Files / Layers Table */}
              <div className="border border-border/20 divide-y divide-border/10 text-xs">
                {hydroFiles.map((file) => (
                  <div
                    key={file.name}
                    className="flex flex-col sm:flex-row sm:items-center justify-between p-3 gap-2 hover:bg-muted/10 transition-colors"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      {file.type === "raster" && <MapIcon className="size-4 shrink-0 text-foreground" />}
                      {file.type === "model" && <Database className="size-4 shrink-0 text-foreground" />}
                      {file.type === "vector" && <Layers className="size-4 shrink-0 text-foreground" />}
                      {file.type === "pointcloud" && <Boxes className="size-4 shrink-0 text-foreground" />}

                      <span className="font-mono font-medium text-foreground truncate">{file.name}</span>
                      <span className="border border-border bg-muted/20 px-1.5 py-0.2 text-[10px] text-foreground shrink-0 font-mono">
                        {file.format}
                      </span>
                    </div>

                    <div className="flex items-center gap-4 sm:ml-auto text-muted-foreground font-mono text-[11px] shrink-0">
                      <span className="truncate max-w-xs hidden md:inline text-muted-foreground/80">
                        {file.commit}
                      </span>
                      <span className="w-16 text-right text-foreground font-medium">{file.size}</span>
                      <span className="w-20 text-right text-foreground">{file.dedup} dedup</span>
                    </div>
                  </div>
                ))}
              </div>

              {/* README.md Preview */}
              <div className="border border-border/20 p-5 mt-2">
                <div className="flex items-center justify-between border-b border-border/20 pb-3 text-xs font-mono">
                  <span className="font-semibold text-foreground">README.hydro.md</span>
                  <span className="text-muted-foreground">Certified against LOCUS v1.4</span>
                </div>
                <div className="pt-4 text-xs space-y-3 text-muted-foreground leading-relaxed">
                  <h3 className="text-sm font-semibold text-foreground">Chalakudy River Basin (Kerala, India)</h3>
                  <p>
                    Full 2D unsteady flow modeling study including 1m LiDAR-derived bare-earth DEM, HEC-RAS 2D
                    hydrodynamic breach simulation, and stochastic rainfall ensemble (100-year return period).
                  </p>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 font-mono text-[11px]">
                    <div className="border border-border/20 p-2">
                      <span className="block text-muted-foreground">Catchment Area</span>
                      <span className="font-bold text-foreground">1,704 km²</span>
                    </div>
                    <div className="border border-border/20 p-2">
                      <span className="block text-muted-foreground">Peak Inflow</span>
                      <span className="font-bold text-foreground">3,850 m³/s</span>
                    </div>
                    <div className="border border-border/20 p-2">
                      <span className="block text-muted-foreground">Mesh Cells</span>
                      <span className="font-bold text-foreground">420,000 2D</span>
                    </div>
                    <div className="border border-border/20 p-2">
                      <span className="block text-muted-foreground">Storage Deduplicated</span>
                      <span className="font-bold text-foreground">17.8 GB (78.8%)</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: VISUAL MAP DIFF */}
          {activeTab === "diff" && (
            <div className="flex flex-col gap-4 border border-border/20 p-5">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/20 pb-3 text-xs">
                <div>
                  <span className="font-mono font-semibold text-foreground">basin_dem.tif &middot; Visual Map Diff</span>
                  <p className="text-muted-foreground mt-0.5">
                    Comparing <span className="font-mono text-foreground">main</span> (parent) &larr;{" "}
                    <span className="font-mono text-foreground">levee-scenario</span> (head) &middot; 320 tiles changed
                  </p>
                </div>
                <Badge variant="outline" className="border-border text-foreground font-mono">
                  +14.2 km² Inundation Extent
                </Badge>
              </div>

              {/* Side-by-side Map Tile Diff */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                <div className="flex flex-col gap-1.5">
                  <span className="text-[11px] font-mono text-muted-foreground">Base Commit: 4a2b91c (Pre-breach)</span>
                  <MapPreview seed={12} className="aspect-video border border-border/30" />
                </div>
                <div className="flex flex-col gap-1.5">
                  <span className="text-[11px] font-mono text-foreground">Head Commit: 7f9ac32 (Breach scenario + 2m delta)</span>
                  <MapPreview
                    seed={12}
                    className="aspect-video border border-border/30"
                    diff={{
                      "2-4": "changed",
                      "2-5": "changed",
                      "3-4": "changed",
                      "3-5": "added",
                      "5-9": "added",
                      "6-9": "changed",
                      "7-2": "removed",
                    }}
                  />
                </div>
              </div>

              <MapDiffLegend />

              {/* Plain-English AI Diff Summary from Section 5.2 */}
              <div className="border border-border/30 bg-muted/10 p-4 text-xs space-y-1.5">
                <div className="flex items-center gap-1.5 font-semibold text-foreground">
                  <Sparkles className="size-3.5 text-accent" />
                  <span>AI Diff Analysis (Section 5.2)</span>
                </div>
                <p className="text-muted-foreground leading-relaxed">
                  Elevation lowered ~2.0m over a 400m stretch near the northern left-bank levee crest. Maximum water depth
                  increases by 1.84m in Sector 4B. Hydraulic connectivity remains intact; zero artificial sinks or
                  spurious disconnected ponds created.
                </p>
              </div>
            </div>
          )}

          {/* TAB 3: NEROLITH LOCUS AUDIT GATE */}
          {activeTab === "locus" && (
            <div className="flex flex-col gap-4 border border-border/20 p-5 text-xs">
              <div className="flex items-center justify-between border-b border-border/20 pb-3">
                <div className="flex items-center gap-2 font-semibold text-foreground text-sm">
                  <ShieldCheck className="size-4 text-accent" />
                  <span>Nerolith LOCUS Audit &amp; Certification Envelope</span>
                </div>
                <Button size="sm" className="bg-foreground text-background">
                  <Download className="mr-1.5 size-3.5" />
                  Export Audit Package
                </Button>
              </div>

              <div className="space-y-3 pt-2">
                <p className="text-muted-foreground leading-relaxed">
                  Craton generates a cryptographic Merkle-tree root hash for every commit. This manifest proves to dam
                  safety authorities, regulators, and insurers that the exact model runs, DEM tiles, and boundary conditions
                  submitted are bit-for-bit identical to what was certified on Nerolith.
                </p>

                <div className="border border-border/30 bg-muted/10 p-4 font-mono space-y-2">
                  <div className="flex justify-between border-b border-border/20 pb-2">
                    <span className="text-muted-foreground">Merkle Root Hash</span>
                    <span className="text-foreground font-bold">0x7f9ac32b84e1902d18440bcfa98112</span>
                  </div>
                  <div className="flex justify-between border-b border-border/20 pb-2">
                    <span className="text-muted-foreground">FastCDC Chunk Count</span>
                    <span className="text-foreground">1,240 content-defined chunks</span>
                  </div>
                  <div className="flex justify-between border-b border-border/20 pb-2">
                    <span className="text-muted-foreground">Hydraulic Connectivity Gate</span>
                    <span className="text-foreground font-medium">PASSED (0 breaks)</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Lossless Compression Verification</span>
                    <span className="text-foreground font-medium">LERC MaxZError = 0 (Bit-identical)</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: FASTCDC & R2 STORAGE */}
          {activeTab === "storage" && (
            <div className="flex flex-col gap-5 border border-border/20 p-5 text-xs">
              <div className="flex items-center justify-between border-b border-border/20 pb-3">
                <div className="flex items-center gap-2 font-semibold text-foreground text-sm">
                  <HardDrive className="size-4 text-foreground" />
                  <span>FastCDC Deduplication &amp; Cloudflare R2 Economics</span>
                </div>
                <span className="font-mono text-foreground font-bold">Zero Egress Fees</span>
              </div>

              <p className="text-muted-foreground leading-relaxed">
                By chunking raw uncompressed rasters with FastCDC Gear hashing before lossless LERC compression, public
                elevation grids and shared baseline layers are stored only once across all users.
              </p>

              {/* Chart */}
              <div className="h-48 w-full min-h-[192px] pt-2">
                <ChartContainer config={dedupChartConfig} className="h-full w-full min-h-[192px]">
                  <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={180}>
                    <AreaChart data={dedupTrendData}>
                      <defs>
                        <linearGradient id="storedGradient" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="var(--foreground)" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="var(--foreground)" stopOpacity={0.0} />
                        </linearGradient>
                      </defs>
                      <XAxis dataKey="month" stroke="var(--muted-foreground)" fontSize={11} />
                      <YAxis stroke="var(--muted-foreground)" fontSize={11} />
                      <RechartsTooltip />
                      <Area
                        type="monotone"
                        dataKey="rawSize"
                        stroke="var(--muted-foreground)"
                        strokeDasharray="3 3"
                        fill="transparent"
                      />
                      <Area
                        type="monotone"
                        dataKey="storedSize"
                        stroke="var(--foreground)"
                        fill="url(#storedGradient)"
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </ChartContainer>
              </div>

              <div className="grid grid-cols-3 gap-3 border-t border-border/20 pt-4 font-mono">
                <div>
                  <span className="text-muted-foreground block text-[11px]">Total Raw Model Data</span>
                  <span className="text-base font-bold text-foreground">22.6 GB</span>
                </div>
                <div>
                  <span className="text-muted-foreground block text-[11px]">Stored on Cloudflare R2</span>
                  <span className="text-base font-bold text-foreground">4.8 GB</span>
                </div>
                <div>
                  <span className="text-muted-foreground block text-[11px]">Storage Saved</span>
                  <span className="text-base font-bold text-foreground">17.8 GB (78.8%)</span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* RIGHT SIDEBAR: PEER REVIEW & REPOSITORY AUDIT STATS */}
        <div className="flex flex-col gap-6">
          {/* Storage Quota Panel */}
          <div className="border border-border/20 p-5 flex flex-col gap-3 text-xs">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-foreground">Storage &amp; Free Quota</span>
              <span className="font-mono text-muted-foreground">4.8 GB / 20 GB</span>
            </div>
            <div className="h-1.5 w-full bg-muted/30">
              <div className="h-full bg-foreground" style={{ width: "24%" }} />
            </div>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              20 GB free tier on Cloudflare R2 with zero egress fees. Shared public DEM tiles (SRTM, CartoDEM) are
              deduplicated and never count against your quota.
            </p>
          </div>

          {/* Model Peer Review & Discussions */}
          <div className="border border-border/20 p-5 flex flex-col gap-4 text-xs">
            <div className="flex items-center justify-between border-b border-border/20 pb-2.5">
              <span className="font-semibold text-foreground">Hydraulic Peer Review</span>
              <span className="font-mono text-[11px] text-foreground font-medium">2 Active Reviewers</span>
            </div>

            {/* Conversation Items */}
            <div className="flex flex-col gap-3.5">
              {discussions.map((d) => (
                <div key={d.id} className="flex flex-col gap-1.5 border-b border-border/10 pb-3 last:border-none">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 font-medium text-foreground">
                      <Avatar className="size-5">
                        <AvatarFallback className="text-[9px]">{d.initials}</AvatarFallback>
                      </Avatar>
                      <span>{d.author}</span>
                    </div>
                    <span className="font-mono text-[10px] text-muted-foreground">{d.time}</span>
                  </div>

                  <p className="text-muted-foreground leading-relaxed">{d.text}</p>

                  {d.attachment && (
                    <div className="flex items-center gap-2 border border-border/30 bg-muted/20 p-2 font-mono text-[11px] text-foreground">
                      <FileSpreadsheet className="size-3.5 text-foreground" />
                      <span>{d.attachment}</span>
                    </div>
                  )}

                  <div className="flex items-center gap-2 pt-0.5">
                    <span className="border border-border/30 bg-muted/20 px-1.5 py-0.2 text-[10px] text-foreground font-mono">
                      {d.badge}
                    </span>
                    <span className="text-[10px] text-foreground font-mono">{d.reaction}</span>
                  </div>
                </div>
              ))}
            </div>

            {/* Discussion Input */}
            <div className="flex items-center gap-2 border-t border-border/20 pt-3">
              <Input
                placeholder="Review comment or Manning n calibration note..."
                value={peerComment}
                onChange={(e) => setPeerComment(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSendDiscussion()}
                className="h-8 border-border/30 bg-muted/10 text-xs focus-visible:ring-0"
              />
              <Button size="icon" variant="outline" onClick={handleSendDiscussion} className="size-8 shrink-0">
                <Send className="size-3" />
              </Button>
            </div>
          </div>

          {/* Quick CLI Actions */}
          <div className="border border-border/20 p-5 flex flex-col gap-3 text-xs font-mono">
            <span className="font-semibold text-foreground">CLI Quick Reference</span>
            <div className="border border-border/30 bg-muted/10 p-2.5 text-muted-foreground space-y-1 text-[11px]">
              <p>
                <span className="text-accent">$</span> craton clone hydrolab/chalakudy-basin
              </p>
              <p>
                <span className="text-accent">$</span> craton diff main..levee-scenario
              </p>
              <p>
                <span className="text-accent">$</span> craton push -m &quot;update 2d mesh&quot;
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
