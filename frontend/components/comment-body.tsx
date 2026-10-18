"use client";

// The text of a comment on an issue or a pull request, with what can be done to it: reactions for anyone signed in, and
// Edit and Delete for its author (Delete also for someone who administers the repository). A comment without an id yet
// (one just posted from a demo, say) is shown as plain text.

import { useState, useTransition } from "react";
import { SmilePlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { notify } from "@/components/button-status";
import { deleteCommentAction, editCommentAction, reactAction } from "@/app/actions";
import { cn } from "@/lib/utils";

export const REACTIONS = [
  ["thumbs_up", "👍", "Thumbs up"],
  ["thumbs_down", "👎", "Thumbs down"],
  ["laugh", "😄", "Laugh"],
  ["hooray", "🎉", "Hooray"],
  ["confused", "😕", "Confused"],
  ["heart", "❤️", "Heart"],
  ["rocket", "🚀", "Rocket"],
  ["eyes", "👀", "Eyes"],
] as const;
export type ReactionName = (typeof REACTIONS)[number][0];
export type Reactions = Partial<Record<ReactionName, { count: number; mine: boolean; by: string[] }>>;

export function CommentBody({
  owner,
  repo,
  commentId,
  author,
  text,
  edited = false,
  reactions = {},
  viewer,
  canModerate = false,
  onDeleted,
}: {
  owner: string;
  repo: string;
  commentId?: number;
  author: string;
  text: string;
  edited?: boolean;
  reactions?: Reactions;
  viewer: string | null;
  canModerate?: boolean;
  onDeleted?: () => void;
}) {
  const [body, setBody] = useState(text);
  const [wasEdited, setWasEdited] = useState(edited);
  const [counts, setCounts] = useState<Reactions>(reactions);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(text);
  const [picking, setPicking] = useState(false);
  const [busy, start] = useTransition();
  const live = commentId !== undefined;
  const mine = viewer !== null && viewer === author;

  function toggle(name: ReactionName) {
    if (!live || !viewer) return;
    const on = !counts[name]?.mine;
    const before = counts;
    const cur = counts[name] ?? { count: 0, mine: false, by: [] };
    const next = { ...cur, count: Math.max(0, cur.count + (on ? 1 : -1)), mine: on, by: on ? [...cur.by, viewer] : cur.by.filter((h) => h !== viewer) };
    setCounts({ ...counts, [name]: next.count ? next : undefined });
    setPicking(false);
    start(async () => {
      const r = await reactAction(owner, repo, commentId, name, on);
      if (!r.ok) {
        setCounts(before);
        notify.error("Couldn’t save your reaction", { description: r.error });
        return;
      }
      setCounts(r.data.reactions);
    });
  }

  function save() {
    const next = draft.trim();
    if (!next) return void notify.error("A comment can’t be empty");
    if (next === body) return void setEditing(false);
    start(async () => {
      const r = await editCommentAction(owner, repo, commentId!, next);
      if (!r.ok) return void notify.error("Couldn’t save the change", { description: r.error });
      setBody(r.data.body);
      setWasEdited(true);
      setEditing(false);
    });
  }

  function remove() {
    if (!window.confirm("Delete this comment? This can’t be undone.")) return;
    start(async () => {
      const r = await deleteCommentAction(owner, repo, commentId!);
      if (!r.ok) return void notify.error("Couldn’t delete the comment", { description: r.error });
      notify.success("Comment deleted");
      onDeleted?.();
    });
  }

  const shown = REACTIONS.filter(([name]) => counts[name]?.count);

  return (
    <div className="px-3 py-3">
      {editing ? (
        <div className="flex flex-col gap-2">
          <label htmlFor={`edit-${commentId}`} className="sr-only">
            Edit comment
          </label>
          <Textarea id={`edit-${commentId}`} value={draft} onChange={(e) => setDraft(e.target.value)} rows={4} autoFocus maxLength={65_536} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => (setDraft(body), setEditing(false))} disabled={busy}>
              Cancel
            </Button>
            <Button type="button" size="sm" onClick={save} loading={busy} disabled={busy || !draft.trim()}>
              Save
            </Button>
          </div>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground text-pretty whitespace-pre-line">
          {body}
          {wasEdited && <span className="ml-2 text-xs text-muted-foreground/70">(edited)</span>}
        </p>
      )}

      {live && !editing && (shown.length > 0 || viewer) && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {shown.map(([name, glyph, label]) => {
            const c = counts[name]!;
            return (
              <button
                key={name}
                type="button"
                disabled={!viewer || busy}
                onClick={() => toggle(name)}
                aria-pressed={c.mine}
                title={`${label}: ${c.by.join(", ")}${c.count > c.by.length ? ` and ${c.count - c.by.length} more` : ""}`}
                className={cn(
                  "inline-flex h-6 cursor-pointer items-center gap-1 rounded-[4px] border px-1.5 text-xs transition-colors disabled:cursor-default",
                  c.mine ? "border-foreground/50 bg-foreground/10 text-foreground" : "border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground",
                )}
              >
                <span aria-hidden>{glyph}</span>
                <span className="tabular-nums">{c.count}</span>
                <span className="sr-only">{label}</span>
              </button>
            );
          })}
          {viewer && (
            <span className="relative">
              <button
                type="button"
                onClick={() => setPicking((v) => !v)}
                aria-expanded={picking}
                aria-label="Add a reaction"
                className="inline-flex size-6 cursor-pointer items-center justify-center rounded-[4px] border border-border text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground"
              >
                <SmilePlus className="size-3.5" aria-hidden />
              </button>
              {picking && (
                <span role="group" aria-label="Reactions" className="absolute bottom-full left-0 z-20 mb-1 flex gap-0.5 border border-border bg-popover p-1 shadow-md">
                  {REACTIONS.map(([name, glyph, label]) => (
                    <button
                      key={name}
                      type="button"
                      onClick={() => toggle(name)}
                      aria-label={label}
                      title={label}
                      className={cn("flex size-7 cursor-pointer items-center justify-center rounded-[4px] text-base transition-colors hover:bg-muted", counts[name]?.mine && "bg-foreground/10")}
                    >
                      {glyph}
                    </button>
                  ))}
                </span>
              )}
            </span>
          )}
          {live && (mine || canModerate) && (
            <span className="ml-auto flex items-center gap-1 text-xs">
              {mine && (
                <button type="button" onClick={() => (setDraft(body), setEditing(true))} className="cursor-pointer rounded-[4px] px-1.5 py-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
                  Edit
                </button>
              )}
              <button type="button" onClick={remove} disabled={busy} className="cursor-pointer rounded-[4px] px-1.5 py-0.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive">
                Delete
              </button>
            </span>
          )}
        </div>
      )}
    </div>
  );
}
