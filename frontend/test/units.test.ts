import { test } from "node:test";
import assert from "node:assert/strict";
import { formatLength, formatVolume, lengthUnit, parseUnits, toLength } from "../lib/units.ts";

test("only an explicit imperial choice turns on imperial; anything else is metric", () => {
  assert.equal(parseUnits("imperial"), "imperial");
  assert.deepEqual([parseUnits("metric"), parseUnits(undefined), parseUnits("feet"), parseUnits(null)], ["metric", "metric", "metric", "metric"]);
});

test("lengths convert at the exact foot, and the unit label follows", () => {
  assert.equal(lengthUnit("metric"), "m");
  assert.equal(lengthUnit("imperial"), "ft");
  assert.ok(Math.abs(toLength(0.3048, "imperial") - 1) < 1e-12, "0.3048 m is one foot");
  assert.equal(toLength(12.5, "metric"), 12.5);
});

test("a change keeps its sign, a real minus, and never shows a signed zero", () => {
  assert.equal(formatLength(0.35, "metric", { signed: true }), "+0.35 m");
  assert.equal(formatLength(-0.35, "metric", { signed: true }), "−0.35 m");
  assert.equal(formatLength(0.3048, "imperial", { signed: true, digits: 1 }), "+1.0 ft");
  assert.equal(formatLength(0.0001, "metric", { signed: true }), "0.00 m");
  assert.equal(formatLength(-0.0001, "metric", { signed: true }), "0.00 m");
  assert.equal(formatLength(1234.5, "metric", { digits: 1 }), "1,234.5 m");
});

test("volumes: cubic metres and millions of them, or acre-feet and cubic feet when small", () => {
  assert.equal(formatVolume(-43010, "metric"), "−43,010 m³");
  assert.equal(formatVolume(2_500_000, "metric"), "+2.50 million m³");
  // 1 acre-foot is 1233.48 cubic metres
  assert.equal(formatVolume(1233.4818375475, "imperial"), "+1.0 acre-ft");
  assert.equal(formatVolume(-43010, "imperial"), "−34.9 acre-ft");
  assert.equal(formatVolume(5_000_000, "imperial"), "+4,054 acre-ft");
  assert.equal(formatVolume(10, "imperial"), "+353 ft³");
  assert.equal(formatVolume(0, "metric"), "0 m³");
});
