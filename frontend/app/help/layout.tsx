import type { Metadata } from "next";

export const metadata: Metadata = { title: "Help", description: "Answers about using Craton, and how to reach the people who run it." };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
