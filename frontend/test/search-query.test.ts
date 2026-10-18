import { test } from "node:test";
import assert from "node:assert/strict";
import { matchesFields, matchesWords, parseQuery, removeOperator, removeToken, stateOperator, type FieldSpec } from "../lib/search-query.ts";

const KEYS = ["is", "label", "author", "assignee", "file", "no"];

test("operators, words, quoted values and exclusions are told apart", () => {
  const p = parseQuery('is:open label:bug author:Priya file:"basin dem.tif" -draft datum "flood plain"', KEYS);
  assert.deepEqual(
    p.operators.map((t) => [t.key, t.value, t.negate]),
    [["is", "open", false], ["label", "bug", false], ["author", "Priya", false], ["file", "basin dem.tif", false]],
  );
  assert.deepEqual(p.words.map((t) => [t.value, t.negate]), [["draft", true], ["datum", false], ["flood plain", false]]);
});

test("a key that is not an operator stays plain text, so EPSG:32643 can still be searched for", () => {
  const p = parseQuery("EPSG:32643 http://example.org foo:bar", KEYS);
  assert.equal(p.operators.length, 0);
  assert.deepEqual(p.words.map((t) => t.value), ["EPSG:32643", "http://example.org", "foo:bar"]);
  assert.ok(matchesWords("CRS is EPSG:32643 here", p) === false, "all three words are required");
  assert.ok(matchesWords("EPSG:32643 http://example.org foo:bar", p));
});

test("keys are case-insensitive, an empty value is not an operator, and a stray dash is text", () => {
  assert.equal(parseQuery("Label:Bug", KEYS).operators[0].key, "label");
  assert.equal(parseQuery("label:", KEYS).operators.length, 0);
  assert.deepEqual(parseQuery("- 9999 -9999", KEYS).words.map((t) => [t.value, t.negate]), [["-", false], ["9999", false], ["-9999", false]], "numbers with a minus are not exclusions");
});

test("words must all appear in any order, and excluded words must not", () => {
  const p = parseQuery("datum -draft", KEYS);
  assert.ok(matchesWords("Fix the vertical DATUM", p));
  assert.ok(!matchesWords("Fix the datum draft", p));
  assert.ok(!matchesWords("Fix the CRS", p));
  assert.ok(matchesWords("anything", parseQuery("", KEYS)), "an empty query matches everything");
});

type Issue = { label: string; author: string; assignee: string | null; reference: string | null; reviewers: string[] };
const fields: Record<string, FieldSpec<Issue>> = {
  label: { get: (i) => i.label, mode: "exact" },
  author: { get: (i) => i.author, mode: "exact" },
  assignee: { get: (i) => i.assignee, mode: "exact" },
  file: { get: (i) => i.reference, mode: "contains" },
  reviewer: { get: (i) => i.reviewers, mode: "exact" },
};
const a: Issue = { label: "bug", author: "priya", assignee: null, reference: "terrain/basin_dem.tif", reviewers: ["arun", "sol"] };
const b: Issue = { label: "question", author: "arun", assignee: "priya", reference: null, reviewers: [] };
const hit = (q: string, i: Issue) => matchesFields(i, parseQuery(q, [...KEYS, "reviewer"]), fields);

test("exact fields compare the whole value, ignoring case", () => {
  assert.ok(hit("label:BUG", a) && !hit("label:BUG", b));
  assert.ok(hit("author:priya", a) && !hit("author:priya", b));
  assert.ok(!hit("author:pri", a), "a prefix of a handle is not the handle");
  assert.ok(hit("-label:bug", b) && !hit("-label:bug", a), "a leading dash excludes");
});

test("contains fields match part of the value, and missing values never match", () => {
  assert.ok(hit("file:basin", a) && !hit("file:basin", b));
  assert.ok(hit("file:dem.tif", a));
  assert.ok(hit("-file:basin", b));
});

test("list-valued fields match any entry, and no: finds empty fields", () => {
  assert.ok(hit("reviewer:sol", a) && !hit("reviewer:sol", b));
  assert.ok(hit("no:assignee", a) && !hit("no:assignee", b));
  assert.ok(hit("-no:assignee", b) && !hit("-no:assignee", a));
  assert.ok(hit("no:reviewer", b) && !hit("no:reviewer", a));
  assert.ok(hit("no:nonsense", a), "an unknown field name is ignored rather than hiding everything");
});

test("several operators all have to hold", () => {
  assert.ok(hit("label:bug author:priya file:basin", a));
  assert.ok(!hit("label:bug author:arun", a));
});

test("is: picks the state when it is one the list allows, and the last one wins", () => {
  const states = ["open", "closed"] as const;
  assert.equal(stateOperator(parseQuery("is:closed bug", KEYS), states), "closed");
  assert.equal(stateOperator(parseQuery("is:open is:closed", KEYS), states), "closed");
  assert.equal(stateOperator(parseQuery("is:merged", KEYS), states), undefined, "not an allowed state here");
  assert.equal(stateOperator(parseQuery("bug", KEYS), states), undefined);
});

test("a chip's remove button takes exactly that token back out", () => {
  const p = parseQuery('is:open label:bug "flood plain" file:"a b"', KEYS);
  assert.equal(removeToken(p, p.operators[1]), 'is:open "flood plain" file:"a b"');
  assert.equal(removeToken(p, p.operators[2]), 'is:open label:bug "flood plain"');
  assert.equal(removeOperator(p, "is"), 'label:bug "flood plain" file:"a b"');
});
