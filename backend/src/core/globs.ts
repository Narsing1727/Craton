// Path patterns for "files that must be locked before they are changed". Same spirit as .gitignore: a
// pattern without a slash matches the file name at any depth, one with a slash is anchored at the
// repository root; `*` stays inside a folder name, `**` crosses folders, `?` is one character.

export function patternToRegExp(pattern: string): RegExp {
  const p = pattern.trim().replace(/^\.?\//, "");
  const anchored = p.includes("/");
  let re = "";
  for (let i = 0; i < p.length; i++) {
    const ch = p[i];
    if (ch === "*") {
      if (p[i + 1] === "*") {
        i++;
        if (p[i + 1] === "/") {
          i++; // "**/" also matches no folder at all
          re += "(?:.*/)?";
        } else re += ".*"; // "dir/**" is everything inside dir
      } else re += "[^/]*";
    } else if (ch === "?") re += "[^/]";
    else re += ch.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(anchored ? `^${re}$` : `^(?:.*/)?${re}$`, "i");
}

export function matchesAny(patterns: string[], path: string): boolean {
  return patterns.some((p) => patternToRegExp(p).test(path));
}

/** Clean user input into a list of patterns, or say what is wrong. */
export function cleanPatterns(input: unknown): { patterns: string[]; problem?: string } {
  const list = Array.isArray(input) ? input : String(input ?? "").split(/\r?\n/);
  const patterns: string[] = [];
  for (const raw of list) {
    const p = String(raw).trim();
    if (!p || p.startsWith("#")) continue;
    if (p.length > 200) return { patterns, problem: "A pattern is longer than 200 characters." };
    if (p.split("/").includes("..") || /[\0\\]/.test(p)) return { patterns, problem: `“${p.slice(0, 40)}” isn’t a repository path pattern.` };
    if (!patterns.includes(p)) patterns.push(p);
  }
  if (patterns.length > 30) return { patterns, problem: "Up to 30 patterns." };
  return { patterns };
}
