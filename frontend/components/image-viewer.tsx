"use client";

// A picture file: shrunk to fit its frame, or at its own size, on a neutral chequerboard so a transparent picture shows where it is transparent.

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

export function ImageViewer({ src, alt }: { src: string; alt: string }) {
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [actual, setActual] = useState(false);
  const [broken, setBroken] = useState(false);
  const img = useRef<HTMLImageElement>(null);
  // A picture that finished loading before the page came alive has already fired its load event.
  useEffect(() => {
    const el = img.current;
    if (el?.complete && el.naturalWidth > 0) setNatural({ w: el.naturalWidth, h: el.naturalHeight });
  }, [src]);
  if (broken) return <p className="px-4 py-6 text-sm text-muted-foreground text-pretty">This picture could not be shown here. It may be damaged, or in a format the browser does not draw. Download it to open it with another program.</p>;
  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2 text-xs">
        <span className="tabular-nums text-muted-foreground">{natural ? `${natural.w.toLocaleString("en-US")} × ${natural.h.toLocaleString("en-US")} px` : "Loading…"}</span>
        <span className="ml-auto flex gap-1">
          <Button type="button" size="sm" variant={!actual ? "default" : "ghost"} aria-pressed={!actual} onClick={() => setActual(false)}>
            Fit
          </Button>
          <Button type="button" size="sm" variant={actual ? "default" : "ghost"} aria-pressed={actual} onClick={() => setActual(true)}>
            Actual size
          </Button>
        </span>
      </div>
      <div
        tabIndex={0}
        role="region"
        aria-label="Picture"
        className="max-h-[40rem] overflow-auto p-4"
        style={{ backgroundImage: "conic-gradient(var(--muted) 25%, transparent 0 50%, var(--muted) 0 75%, transparent 0)", backgroundSize: "16px 16px", backgroundColor: "color-mix(in oklab, var(--muted) 40%, transparent)" }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- a user's file, served by our own route */}
        <img
          ref={img}
          src={src}
          alt={alt}
          onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
          onError={() => setBroken(true)}
          className={actual ? "max-w-none" : "mx-auto h-auto max-h-[36rem] max-w-full object-contain"}
        />
      </div>
    </div>
  );
}
