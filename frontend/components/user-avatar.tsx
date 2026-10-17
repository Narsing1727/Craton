// A person's picture, or their initials where they have none. One component so every place a person appears (the header,
// profile, commits, contributors, settings) shows the same thing; the picture is served by app/avatar/[handle].

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

export const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");

export function UserAvatar({ handle, name, className, fallbackClassName, version }: { handle: string; name?: string; className?: string; fallbackClassName?: string; version?: string | number }) {
  return (
    <Avatar className={className}>
      <AvatarImage src={`/avatar/${encodeURIComponent(handle)}${version ? `?v=${version}` : ""}`} alt="" />
      <AvatarFallback className={fallbackClassName}>{initialsOf(name || handle) || handle.slice(0, 2).toUpperCase()}</AvatarFallback>
    </Avatar>
  );
}
