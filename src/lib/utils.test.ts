import { assertEquals, assertMatch, assertNotEquals } from "jsr:@std/assert";
import { clampText, nowIso, randomToken, safeText } from "./utils.ts";

Deno.test("nowIso returns a valid ISO 8601 string", () => {
  const iso = nowIso();
  assertMatch(iso, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  assertEquals(isNaN(new Date(iso).getTime()), false);
});

Deno.test("nowIso is close to current time", () => {
  const before = Date.now();
  const iso = nowIso();
  const after = Date.now();
  const t = new Date(iso).getTime();
  assertEquals(t >= before && t <= after, true);
});

// safeText
Deno.test("safeText trims leading and trailing whitespace", () => {
  assertEquals(safeText("  hello  "), "hello");
});

Deno.test("safeText coerces null to empty string", () => {
  assertEquals(safeText(null), "");
});

Deno.test("safeText coerces undefined to empty string", () => {
  assertEquals(safeText(undefined), "");
});

Deno.test("safeText coerces numbers to string", () => {
  assertEquals(safeText(42), "42");
});

Deno.test("safeText passes through normal strings unchanged", () => {
  assertEquals(safeText("hello"), "hello");
});

// clampText
Deno.test("clampText returns string unchanged when under max", () => {
  assertEquals(clampText("hello", 10), "hello");
});

Deno.test("clampText returns string unchanged when exactly at max", () => {
  assertEquals(clampText("hello", 5), "hello");
});

Deno.test("clampText truncates string to max length", () => {
  assertEquals(clampText("hello world", 5), "hello");
});

Deno.test("clampText default max is 5000", () => {
  const s = "x".repeat(5001);
  assertEquals(clampText(s).length, 5000);
});

Deno.test("clampText does not truncate at exactly 5000 chars", () => {
  const s = "x".repeat(5000);
  assertEquals(clampText(s).length, 5000);
});

// randomToken
Deno.test("randomToken returns a non-empty string", () => {
  assertEquals(randomToken().length > 0, true);
});

Deno.test("randomToken is URL-safe (no +, /, or = chars)", () => {
  const tok = randomToken();
  assertMatch(tok, /^[A-Za-z0-9\-_]+$/);
});

Deno.test("randomToken produces unique values", () => {
  assertNotEquals(randomToken(), randomToken());
});

Deno.test("randomToken has expected length from 24 bytes", () => {
  // 24 bytes → 32 base64 chars without padding
  assertEquals(randomToken().length, 32);
});
