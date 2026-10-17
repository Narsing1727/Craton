"use client";

import { useRouter } from "next/navigation";
import { RotateCcw } from "lucide-react";
import { notify } from "@/components/button-status";
import { Button } from "@/components/ui/button";
import { ConfirmAction } from "@/components/craton-actions";
import { useSession } from "@/components/session";
import { useCanWrite } from "@/components/repo-context";
import { restoreFileAction } from "@/app/actions";

/** Put a file back to an earlier version. It adds a commit to the branch; nothing is rewritten or lost. */
export function RestoreButton({ owner, repo, path, from, branch }: { owner: string; repo: string; path: string; from: string; branch: string }) {
  const router = useRouter();
  const user = useSession();
  const canWrite = useCanWrite();
  if (!user || !canWrite) return null;
  const filename = path.split("/").pop() ?? path;

  async function restore() {
    const r = await restoreFileAction(owner, repo, { path, from, branch });
    if (!r.ok) {
      notify.error("Couldn’t restore the file", { description: r.error });
      return;
    }
    notify.success(`Restored ${filename}`, { description: `Added a commit to ${branch}. The version you replaced is still in the history.` });
    router.push(`/${owner}/${repo}/blob/${path.split("/").map(encodeURIComponent).join("/")}${branch === "main" ? "" : `?ref=${encodeURIComponent(branch)}`}`);
    router.refresh();
  }

  return (
    <ConfirmAction
      destructive={false}
      trigger={
        <Button variant="ghost" size="xs">
          <RotateCcw data-icon="inline-start" />
          Restore
        </Button>
      }
      title={`Restore ${filename} to ${from.slice(0, 7)}?`}
      description={`This adds a new commit on ${branch} that puts the file back to how it was then. Nothing is deleted: the current version stays in the history, and you can restore it again.`}
      confirmLabel="Restore this version"
      onConfirm={() => void restore()}
    />
  );
}
