import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { loadOwner, noData } from "@/lib/source";
import { OrgSettingsView } from "./org-settings-view";

export async function generateMetadata({ params }: { params: Promise<{ org: string }> }): Promise<Metadata> {
  return { title: `Settings · ${(await params).org}` };
}

export default async function OrgSettingsPage({ params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  const [user, owner] = await Promise.all([requireUser(`/orgs/${org}/settings`), loadOwner(org)]);
  if (!owner) await noData();
  if (!owner || owner.kind !== "org") notFound();
  const role = owner.members?.find((m) => m.handle === user?.handle)?.role ?? null;
  return <OrgSettingsView org={owner.handle} name={owner.name} bio={owner.bio} role={role} repositories={owner.repositories.length} />;
}
