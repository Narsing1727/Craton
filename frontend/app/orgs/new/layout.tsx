import type { Metadata } from "next";

export const metadata: Metadata = { title: "New organization", description: "Create an organization to share repositories with a team." };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
