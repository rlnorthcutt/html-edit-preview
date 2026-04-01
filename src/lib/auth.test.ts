import { assertEquals, assertExists } from "jsr:@std/assert";
import { getEffectivePassword, getSessionTokenFromRequest, requireAuth } from "./auth.ts";
import { PreviewDB } from "../db/sql.ts";

function makeDb(): PreviewDB {
  return new PreviewDB(":memory:");
}

function futureExpiry(): string {
  return new Date(Date.now() + 3_600_000).toISOString();
}

function pastExpiry(): string {
  return new Date(Date.now() - 1_000).toISOString();
}

// getEffectivePassword
Deno.test("getEffectivePassword falls back to env default when no DB setting", () => {
  const db = makeDb();
  const pw = getEffectivePassword(db);
  assertEquals(typeof pw, "string");
  assertEquals(pw.length > 0, true);
});

Deno.test("getEffectivePassword returns the DB setting when set", () => {
  const db = makeDb();
  db.setSetting("global_password", "custom-pass");
  assertEquals(getEffectivePassword(db), "custom-pass");
});

Deno.test("getEffectivePassword prefers DB setting over env fallback", () => {
  const db = makeDb();
  db.setSetting("global_password", "db-password");
  const pw = getEffectivePassword(db);
  assertEquals(pw, "db-password");
});

// getSessionTokenFromRequest
Deno.test("getSessionTokenFromRequest extracts X-Session-Token header", () => {
  const req = new Request("http://localhost/", {
    headers: { "X-Session-Token": "tok-abc" },
  });
  assertEquals(getSessionTokenFromRequest(req), "tok-abc");
});

Deno.test("getSessionTokenFromRequest returns null when header is absent", () => {
  const req = new Request("http://localhost/");
  assertEquals(getSessionTokenFromRequest(req), null);
});

// requireAuth
Deno.test("requireAuth returns null when no token present", () => {
  const db = makeDb();
  const req = new Request("http://localhost/");
  assertEquals(requireAuth(db, req), null);
});

Deno.test("requireAuth returns authed user for valid header token", () => {
  const db = makeDb();
  db.createSession("hdr-tok", "alice", futureExpiry());
  const req = new Request("http://localhost/", {
    headers: { "X-Session-Token": "hdr-tok" },
  });
  const auth = requireAuth(db, req);
  assertExists(auth);
  assertEquals(auth.name, "alice");
  assertEquals(auth.token, "hdr-tok");
});

Deno.test("requireAuth returns authed user for valid cookie token", () => {
  const db = makeDb();
  db.createSession("cookie-tok", "bob", futureExpiry());
  const req = new Request("http://localhost/", {
    headers: { "cookie": "preview_token=cookie-tok; other=irrelevant" },
  });
  const auth = requireAuth(db, req);
  assertExists(auth);
  assertEquals(auth.name, "bob");
});

Deno.test("requireAuth returns null for expired session", () => {
  const db = makeDb();
  db.createSession("exp-tok", "carol", pastExpiry());
  const req = new Request("http://localhost/", {
    headers: { "X-Session-Token": "exp-tok" },
  });
  assertEquals(requireAuth(db, req), null);
});

Deno.test("requireAuth returns null for unknown token", () => {
  const db = makeDb();
  const req = new Request("http://localhost/", {
    headers: { "X-Session-Token": "no-such-token" },
  });
  assertEquals(requireAuth(db, req), null);
});

Deno.test("requireAuth prefers header token over cookie token", () => {
  const db = makeDb();
  db.createSession("hdr-tok", "from-header", futureExpiry());
  db.createSession("ck-tok", "from-cookie", futureExpiry());
  const req = new Request("http://localhost/", {
    headers: {
      "X-Session-Token": "hdr-tok",
      "cookie": "preview_token=ck-tok",
    },
  });
  const auth = requireAuth(db, req);
  assertExists(auth);
  assertEquals(auth.name, "from-header");
});
