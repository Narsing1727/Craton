"use client";

// One sample from each vendored library, on Craton's tokens and real Craton data where it fits.
// Where each library lives and how to add more: components/VENDOR.md.

import { Bell, Database, GitBranch, Layers } from "lucide-react";
import { AppShell } from "@/components/app-shell";
// shadcn (official, base-nova)
import { Slider } from "@/components/ui/slider";
// coss ui
import { Meter, MeterIndicator, MeterLabel, MeterTrack, MeterValue } from "@/components/ui/meter";
// Kibo UI
import { Status, StatusIndicator, StatusLabel } from "@/components/kibo-ui/status";
import { Pill } from "@/components/kibo-ui/pill";
// Dice UI
import { CompareSlider, CompareSliderAfter, CompareSliderBefore, CompareSliderHandle } from "@/components/ui/compare-slider";
import { Stat, StatDescription, StatLabel, StatValue } from "@/components/ui/stat";
// ReUI
import { IconTile } from "@/components/reui/icon-tile";
// Magic UI
import { AnimatedSpan, Terminal, TypingAnimation } from "@/components/ui/terminal";
import { NumberTicker } from "@/components/ui/number-ticker";
// Animate UI
import { CopyButton } from "@/components/animate-ui/components/buttons/copy";
// Cult UI
import { BrowserWindow } from "@/components/ui/mock-browser-window";
// Kokonut UI
import Loader from "@/components/kokonutui/loader";
// SmoothUI
import NotificationBadge from "@/components/smoothui/notification-badge";
import BreakpointIndicator from "@/components/smoothui/breakpoint-indicator";
// Watermelon UI
import { LabeledProgressIndicator } from "@/components/watermelon/labeled-progress-indicator";
// Motion Primitives
import { TextShimmer } from "@/components/ui/text-shimmer";
import { ImageComparison, ImageComparisonImage, ImageComparisonSlider } from "@/components/ui/image-comparison";

const R = "/hydrolab/chalakudy-basin/render/terrain/basin_dem.tif";
const BEFORE = `${R}?ref=main&size=384`;
const CHANGE = `${R}?ref=develop&base=main&size=384`;

function Cell({ lib, name, children }: { lib: string; name: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3 border border-border bg-card p-4">
      <header className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-medium">{name}</h2>
        <span className="font-mono text-[11px] text-muted-foreground">{lib}</span>
      </header>
      <div className="flex min-h-24 flex-1 flex-col justify-center gap-3">{children}</div>
    </section>
  );
}

export function Gallery() {
  return (
    <AppShell>
      <BreakpointIndicator />
      <div className="flex w-full flex-col gap-6 px-4 py-8 sm:px-6 lg:px-8 xl:px-10">
        <div>
          <h1 className="text-xl font-semibold">Component gallery</h1>
          <p className="mt-1 text-sm text-muted-foreground">Dev only. One component from each vendored library, rendered on Craton’s theme.</p>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          <Cell lib="Dice UI" name="Compare slider · DEM before/after">
            <CompareSlider defaultValue={50} className="aspect-video w-full overflow-hidden border border-border">
              <CompareSliderBefore>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={BEFORE} alt="DEM on main" className="size-full object-cover" />
              </CompareSliderBefore>
              <CompareSliderAfter>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={CHANGE} alt="Elevation change on develop" className="size-full object-cover" />
              </CompareSliderAfter>
              <CompareSliderHandle />
            </CompareSlider>
          </Cell>

          <Cell lib="Motion Primitives" name="Image comparison · hover to swipe">
            <ImageComparison className="aspect-video w-full border border-border" enableHover>
              <ImageComparisonImage src={BEFORE} alt="Hillshade" position="left" />
              <ImageComparisonImage src={CHANGE} alt="Elevation change" position="right" />
              <ImageComparisonSlider className="w-0.5 bg-foreground/60" />
            </ImageComparison>
          </Cell>

          <Cell lib="Magic UI" name="Terminal · CLI walkthrough">
            <Terminal className="max-w-full">
              <TypingAnimation>&gt; craton push</TypingAnimation>
              <AnimatedSpan className="text-muted-foreground">✔ 3 new chunks, 12 reused (398 KB)</AnimatedSpan>
              <AnimatedSpan className="text-muted-foreground">✔ Merkle root 9ecd9e4… verified</AnimatedSpan>
            </Terminal>
          </Cell>

          <Cell lib="coss ui" name="Meter · storage">
            <Meter value={38}>
              <div className="flex justify-between text-sm">
                <MeterLabel>Stored after dedup</MeterLabel>
                <MeterValue />
              </div>
              <MeterTrack>
                <MeterIndicator />
              </MeterTrack>
            </Meter>
          </Cell>

          <Cell lib="Dice UI · Magic UI" name="Stat with number ticker">
            <Stat>
              <StatLabel>Saved by deduplication</StatLabel>
              <StatValue>
                <NumberTicker value={38} />%
              </StatValue>
              <StatDescription>4.0 MB stored vs 6.4 MB for every version</StatDescription>
            </Stat>
          </Cell>

          <Cell lib="Kibo UI" name="Status · pill">
            <div className="flex flex-wrap items-center gap-3">
              <Status status="online">
                <StatusIndicator />
                <StatusLabel>API</StatusLabel>
              </Status>
              <Status status="degraded">
                <StatusIndicator />
                <StatusLabel>Checks</StatusLabel>
              </Status>
              <Pill>EPSG:32643</Pill>
            </div>
          </Cell>

          <Cell lib="ReUI" name="Icon tiles">
            <div className="flex gap-2">
              <IconTile>
                <Database />
              </IconTile>
              <IconTile>
                <GitBranch />
              </IconTile>
              <IconTile>
                <Layers />
              </IconTile>
            </div>
          </Cell>

          <Cell lib="Animate UI" name="Copy button">
            <div className="flex items-center gap-2 border border-border bg-muted/30 py-1 pl-3 pr-1 font-mono text-xs">
              <span className="flex-1 truncate">craton clone hydrolab/chalakudy-basin</span>
              <CopyButton content="craton clone hydrolab/chalakudy-basin" variant="ghost" size="sm" />
            </div>
          </Cell>

          <Cell lib="Watermelon UI" name="Labeled progress · push">
            <LabeledProgressIndicator labels={["Hashing chunks", "Uploading 3 new chunks", "Verifying Merkle root", "Running checks"]} />
          </Cell>

          <Cell lib="SmoothUI" name="Notification badge">
            <div className="inline-flex w-fit">
              <NotificationBadge variant="count" count={3}>
                <Bell className="size-5" aria-label="Notifications" />
              </NotificationBadge>
            </div>
          </Cell>

          <Cell lib="Kokonut UI" name="Loader">
            <Loader title="Rendering preview" subtitle="Reading the smallest COG overview" size="sm" />
          </Cell>

          <Cell lib="Motion Primitives · shadcn" name="Text shimmer · slider">
            <TextShimmer className="text-sm">Rendering hillshade…</TextShimmer>
            <Slider defaultValue={[40]} aria-label="Opacity" />
          </Cell>

          <Cell lib="Cult UI" name="Browser window · real screenshot frame">
            <BrowserWindow url="craton/hydrolab/chalakudy-basin" size="sm" headerStyle="minimal" variant="generic" theme="dark">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={BEFORE} alt="Repository preview" className="aspect-video w-full object-cover" />
            </BrowserWindow>
          </Cell>
        </div>
      </div>
    </AppShell>
  );
}
