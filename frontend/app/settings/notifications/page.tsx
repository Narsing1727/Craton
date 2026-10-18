import type { Metadata } from "next";
import { NotificationsView } from "./notifications-view";
import { requireUser } from "@/lib/auth";

export const metadata: Metadata = { title: "Notifications · Settings" };

const ALL_ON = { review_requests: true, checks_failed: true, repo_access: true, webhook_paused: true, storage: true };

export default async function NotificationsSettingsPage() {
  const user = await requireUser("/settings/notifications");
  return <NotificationsView email={user?.email ?? "priya@hydrolab.org"} emailVerified={user?.emailVerified ?? true} digest={user?.digest ?? "off"} choices={{ ...ALL_ON, ...user?.notify }} live={Boolean(user)} />;
}
