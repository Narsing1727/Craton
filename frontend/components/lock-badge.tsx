import { Lock } from "lucide-react";

/** Marks a file someone has locked for editing. Plain markup, so server and client pages can both use it. */
/** `announce`: add hidden text saying the file is locked, for places where no sentence around it already does. */
export function LockBadge({ holder, reason, className, announce = true }: { holder: string; reason?: string; className?: string; announce?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1 ${className ?? ""}`} title={`Locked by @${holder}${reason ? `: ${reason}` : ""}`}>
      <Lock className="size-3" aria-hidden />
      <span>@{holder}</span>
      {announce && <span className="sr-only">has this file locked</span>}
    </span>
  );
}
