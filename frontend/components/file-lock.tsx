"use client";

// Lock / unlock control for one file, next to its other actions. Locking says "I'm editing this,
// nobody else push a change to it" - for files that can't be merged. Anyone can read a locked
// file; the API refuses a push or merge that changes it until the lock is released.

import * as React from "react";
import { useRouter } from "next/navigation";
import { Lock, LockOpen } from "lucide-react";
import { notify } from "@/components/button-status";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ConfirmAction } from "@/components/craton-actions";
import { LockBadge } from "@/components/lock-badge";
import { useSession } from "@/components/session";
import { useCanWrite } from "@/components/repo-context";
import { lockFileAction, unlockFileAction } from "@/app/actions";

export type FileLockState = { holder: string; reason: string; lockedAt: string; ageDays?: number; stale?: boolean } | null;

/** "held for 12 days" once a lock is old enough to matter, otherwise nothing. */
function heldFor(lock: NonNullable<FileLockState>) {
  if (!lock.stale || lock.ageDays === undefined) return null;
  return `Held for ${lock.ageDays} days`;
}

export function FileLockControl({ owner, repo, path, lock }: { owner: string; repo: string; path: string; lock: FileLockState }) {
  const router = useRouter();
  const user = useSession();
  const [open, setOpen] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const [pending, setPending] = React.useState(false);

  // Only people who can write to this owner see the buttons; reading a lock needs no account.
  const canWrite = useCanWrite();
  const mine = Boolean(user && lock && lock.holder === user.handle);
  const filename = path.split("/").pop() ?? path;

  async function lockIt(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    const r = await lockFileAction(owner, repo, path, reason.trim());
    setPending(false);
    if (!r.ok) {
      notify.error("Couldn’t lock the file", { description: r.error });
      return;
    }
    setOpen(false);
    setReason("");
    notify.success(`Locked ${filename}`, { description: "Others can still read it; changes to it are refused until you unlock." });
    router.refresh();
  }

  async function release(force: boolean) {
    const r = await unlockFileAction(owner, repo, path, force);
    if (!r.ok) {
      notify.error("Couldn’t release the lock", { description: r.error });
      return;
    }
    notify.success(`Unlocked ${filename}`);
    router.refresh();
  }

  if (lock && mine) {
    return (
      <div className="flex items-center gap-2">
        {heldFor(lock) && <span className="text-xs text-muted-foreground" title="Release it when you have pushed your changes, so others can edit this file.">{heldFor(lock)}</span>}
        <Button variant="outline" size="sm" onClick={() => void release(false)}>
          <LockOpen data-icon="inline-start" />
          Unlock
        </Button>
      </div>
    );
  }

  if (lock) {
    // Someone else holds it. The owner of the repository can always release it.
    return (
      <div className="flex items-center gap-2">
        <LockBadge holder={lock.holder} reason={lock.reason} className="border border-border px-2 py-1 text-xs text-muted-foreground" />
        {heldFor(lock) && <span className="text-xs text-muted-foreground">{heldFor(lock)}</span>}
        {user && user.handle === owner && (
          <ConfirmAction
            trigger={
              <Button variant="outline" size="sm">
                Release lock
              </Button>
            }
            title={`Release @${lock.holder}’s lock?`}
            description={`${filename} becomes editable by everyone again. @${lock.holder} may still have unpushed changes to it.`}
            confirmLabel="Release lock"
            onConfirm={() => void release(true)}
          />
        )}
      </div>
    );
  }

  if (!canWrite) return null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>
        <Lock data-icon="inline-start" />
        Lock
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={lockIt} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Lock {filename}</DialogTitle>
            <DialogDescription>
              Use this for files that can’t be merged. Everyone can still read it, but a push or merge that changes it is refused until you unlock it.
            </DialogDescription>
          </DialogHeader>
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="text-muted-foreground">Why (optional, shown to others)</span>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} placeholder="Recalibrating Manning’s n" autoFocus />
          </label>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={pending} disabled={pending}>
              Lock file
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
