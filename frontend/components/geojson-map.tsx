"use client";

// A GeoJSON document on the same pan-and-zoom map as a shapefile, with its properties as the attribute table.

import { useMemo } from "react";
import { VectorMap } from "@/components/vector-map";
import { geojsonFeatures } from "@/lib/geojson";

export function GeoJsonMap({ text, alt }: { text: string; alt: string }) {
  const data = useMemo(() => geojsonFeatures(text), [text]);
  if (!data) return <p className="px-4 py-3 text-xs text-muted-foreground text-pretty">Nothing in this document can be drawn on a map.</p>;
  return (
    <div className="p-4">
      <VectorMap source={data} alt={alt} />
    </div>
  );
}
