// A small search language for the issue and pull request lists, the way Google and GitHub do it:
//
//   is:open label:bug author:priya file:"basin dem" -draft no:assignee datum
//
// `key:value` is an operator only when the key is one the list knows; anything else, like
// EPSG:32643, stays ordinary text. Values can be quoted to hold spaces, a leading `-` excludes, and
// plain words must all appear (in any order). Pure functions, so they are easy to test.

export type Token = {
  /** Exactly as typed, so a chip's remove button can take it back out of the text. */
  raw: string;
  /** The operator, or undefined for a plain word or phrase. */
  key?: string;
  value: string;
  negate: boolean;
};

export type ParsedQuery = { tokens: Token[]; words: Token[]; operators: Token[] };

const TOKEN = /(-?)(?:([A-Za-z]+):)?(?:"([^"]*)"|(\S+))/g;

export function parseQuery(input: string, keys: readonly string[]): ParsedQuery {
  const known = new Set(keys.map((k) => k.toLowerCase()));
  const tokens: Token[] = [];
  for (const m of input.matchAll(TOKEN)) {
    const [raw, dash, rawKey, quoted, bare] = m;
    const key = rawKey?.toLowerCase();
    const value = (quoted ?? bare ?? "").trim();
    if (key && known.has(key) && value !== "") {
      tokens.push({ raw, key, value, negate: dash === "-" });
    } else if (dash === "-" && !rawKey && /^[A-Za-z]/.test(value)) {
      tokens.push({ raw, value, negate: true }); // -draft: exclude a word
    } else {
      // Text, including a `key:` that isn't an operator here (EPSG:32643) and a stray "-".
      const text = raw.replace(/^"(.*)"$/, "$1");
      if (text.trim()) tokens.push({ raw, value: text, negate: false });
    }
  }
  return { tokens, words: tokens.filter((t) => !t.key), operators: tokens.filter((t) => t.key) };
}

/** The query with one token taken out (what the chip's × does). */
export function removeToken(parsed: ParsedQuery, token: Token): string {
  return parsed.tokens.filter((t) => t !== token).map((t) => t.raw).join(" ");
}

/** The query with every operator of one kind taken out, e.g. when a toolbar button takes over `is:`. */
export function removeOperator(parsed: ParsedQuery, key: string): string {
  return parsed.tokens.filter((t) => t.key !== key).map((t) => t.raw).join(" ");
}

/** Plain words: every wanted one must be in the haystack and no excluded one may be. */
export function matchesWords(haystack: string, parsed: ParsedQuery): boolean {
  const text = haystack.toLowerCase();
  return parsed.words.every((w) => text.includes(w.value.toLowerCase()) !== w.negate);
}

export type FieldSpec<T> = {
  get: (item: T) => string | string[] | null | undefined;
  /** `exact`: the whole value must be the same (labels, handles). `contains`: a substring is enough (file paths, branches). */
  mode: "exact" | "contains";
};

/**
 * Operators other than `is` (which the caller handles, as it is the list's open/closed state).
 * `no:assignee` is true when that field is empty.
 */
export function matchesFields<T>(item: T, parsed: ParsedQuery, fields: Record<string, FieldSpec<T>>): boolean {
  for (const op of parsed.operators) {
    if (op.key === "is") continue;
    const want = op.value.toLowerCase();
    if (op.key === "no") {
      const spec = fields[want];
      if (!spec) continue;
      const v = spec.get(item);
      const empty = v == null || v === "" || (Array.isArray(v) && v.length === 0);
      if (empty === op.negate) return false;
      continue;
    }
    const spec = fields[op.key!];
    if (!spec) continue;
    const raw = spec.get(item);
    const values = (Array.isArray(raw) ? raw : raw == null ? [] : [raw]).map((v) => v.toLowerCase());
    const hit = values.some((v) => (spec.mode === "exact" ? v === want : v.includes(want)));
    if (hit === op.negate) return false;
  }
  return true;
}

/** The last `is:` value, if there is one and it is allowed. */
export function stateOperator<S extends string>(parsed: ParsedQuery, allowed: readonly S[]): S | undefined {
  const last = [...parsed.operators].reverse().find((t) => t.key === "is" && !t.negate);
  const v = last?.value.toLowerCase();
  return allowed.find((a) => a === v);
}
