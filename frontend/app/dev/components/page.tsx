import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Gallery } from "./gallery";

export const metadata: Metadata = { title: "Component gallery" };

// A dev-only check that vendored components sit on Craton's theme. Not part of the product.
export default function ComponentGalleryPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <Gallery />;
}
