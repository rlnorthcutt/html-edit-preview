import { assert, assertEquals, assertExists } from "jsr:@std/assert";
import { Hono } from "https://deno.land/x/hono@v4.3.11/mod.ts";
import { PreviewDB } from "../db/sql.ts";
import { createApiRouter } from "./api.ts";

// ---- Test helpers ----

function createTestApp(): { app: Hono; db: PreviewDB } {
  const db = new PreviewDB(":memory:");
  const app = new Hono();
  app.route("/api", createApiRouter(db));
  return { app, db };
}

async function login(
  app: Hono,
  name = "tester",
  password = "s@mpl3-p@ssw0rd",
): Promise<{ ok: boolean; token: string; name: string }> {
  const res = await app.request("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, password }),
  });
  return res.json();
}

function authHeaders(token: string): Record<string, string> {
  return { "X-Session-Token": token };
}

async function createPreview(app: Hono, token: string, title = "Test Preview"): Promise<number> {
  const res = await app.request("/api/previews", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders(token) },
    body: JSON.stringify({ title, description: "", status: "Draft", type: "Mockup", owner: "tester" }),
  });
  const data = await res.json();
  return data.id as number;
}

async function saveHtml(app: Hono, token: string, id: number, html: string) {
  return app.request(`/api/previews/${id}/html`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...authHeaders(token) },
    body: JSON.stringify({ html }),
  });
}

// ---- Auth ----

Deno.test("POST /api/auth/login succeeds with correct password", async () => {
  const { app } = createTestApp();
  const data = await login(app);
  assertEquals(data.ok, true);
  assertExists(data.token);
  assertEquals(data.name, "tester");
});

Deno.test("POST /api/auth/login returns 401 with wrong password", async () => {
  const { app } = createTestApp();
  const res = await app.request("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "x", password: "wrong" }),
  });
  assertEquals(res.status, 401);
  assertEquals((await res.json()).ok, false);
});

Deno.test("POST /api/auth/login returns 400 without name", async () => {
  const { app } = createTestApp();
  const res = await app.request("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "", password: "s@mpl3-p@ssw0rd" }),
  });
  assertEquals(res.status, 400);
});

Deno.test("GET /api/auth/me returns user info when authenticated", async () => {
  const { app } = createTestApp();
  const { token } = await login(app);
  const res = await app.request("/api/auth/me", { headers: authHeaders(token) });
  const data = await res.json();
  assertEquals(data.ok, true);
  assertEquals(data.name, "tester");
});

Deno.test("GET /api/auth/me returns 401 without session", async () => {
  const { app } = createTestApp();
  assertEquals((await app.request("/api/auth/me")).status, 401);
});

Deno.test("POST /api/auth/logout invalidates session", async () => {
  const { app } = createTestApp();
  const { token } = await login(app);
  await app.request("/api/auth/logout", { method: "POST", headers: authHeaders(token) });
  assertEquals((await app.request("/api/auth/me", { headers: authHeaders(token) })).status, 401);
});

// ---- Previews ----

Deno.test("POST /api/previews creates a preview and returns id", async () => {
  const { app } = createTestApp();
  const { token } = await login(app);
  const res = await app.request("/api/previews", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders(token) },
    body: JSON.stringify({ title: "New", description: "D", status: "Draft", type: "Mockup", owner: "me" }),
  });
  const data = await res.json();
  assertEquals(data.ok, true);
  assert(typeof data.id === "number" && data.id > 0);
});

Deno.test("POST /api/previews returns 401 without auth", async () => {
  const { app } = createTestApp();
  const res = await app.request("/api/previews", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: "T", description: "", status: "Draft", type: "Mockup", owner: "" }),
  });
  assertEquals(res.status, 401);
});

Deno.test("PUT /api/previews/:id/html saves the html and creates a version", async () => {
  const { app, db } = createTestApp();
  const { token } = await login(app);
  const id = await createPreview(app, token);

  const res = await saveHtml(app, token, id, "<p>hello</p>");
  assertEquals((await res.json()).ok, true);
  assertEquals(db.getPreview(id)?.html_content, "<p>hello</p>");
  assertEquals(db.listVersions(id).length, 1);
});

Deno.test("PUT /api/previews/:id/html creates a version on each save", async () => {
  const { app, db } = createTestApp();
  const { token } = await login(app);
  const id = await createPreview(app, token);

  await saveHtml(app, token, id, "<p>v1</p>");
  await saveHtml(app, token, id, "<p>v2</p>");
  assertEquals(db.listVersions(id).length, 2);
});

Deno.test("PUT /api/previews/:id/html returns 413 for content over 1 MB", async () => {
  const { app } = createTestApp();
  const { token } = await login(app);
  const id = await createPreview(app, token);

  const res = await saveHtml(app, token, id, "x".repeat(1_000_001));
  assertEquals(res.status, 413);
});

Deno.test("PUT /api/previews/:id/html returns 401 without auth", async () => {
  const { app } = createTestApp();
  const { token } = await login(app);
  const id = await createPreview(app, token);

  const res = await app.request(`/api/previews/${id}/html`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ html: "<p>x</p>" }),
  });
  assertEquals(res.status, 401);
});

Deno.test("PUT /api/previews/:id/meta updates preview metadata", async () => {
  const { app, db } = createTestApp();
  const { token } = await login(app);
  const id = await createPreview(app, token, "Old Title");

  const res = await app.request(`/api/previews/${id}/meta`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...authHeaders(token) },
    body: JSON.stringify({ title: "New Title", description: "D", status: "Approved", type: "Email", owner: "bob" }),
  });
  assertEquals((await res.json()).ok, true);
  assertEquals(db.getPreview(id)?.title, "New Title");
  assertEquals(db.getPreview(id)?.status, "Approved");
  assertEquals(db.getPreview(id)?.type, "Email");
});

Deno.test("DELETE /api/previews/:id removes the preview", async () => {
  const { app, db } = createTestApp();
  const { token } = await login(app);
  const id = await createPreview(app, token);

  await app.request(`/api/previews/${id}`, { method: "DELETE", headers: authHeaders(token) });
  assertEquals(db.getPreview(id), null);
});

Deno.test("DELETE /api/previews/:id returns 401 without auth", async () => {
  const { app } = createTestApp();
  const { token } = await login(app);
  const id = await createPreview(app, token);

  const res = await app.request(`/api/previews/${id}`, { method: "DELETE" });
  assertEquals(res.status, 401);
});

// ---- Versions ----

async function setupVersionedPreview(app: Hono, token: string): Promise<number> {
  const id = await createPreview(app, token);
  await saveHtml(app, token, id, "<p>v1</p>");
  await saveHtml(app, token, id, "<p>v2</p>");
  return id;
}

Deno.test("GET /api/previews/:id/versions returns all versions", async () => {
  const { app } = createTestApp();
  const { token } = await login(app);
  const id = await setupVersionedPreview(app, token);

  const res = await app.request(`/api/previews/${id}/versions`, { headers: authHeaders(token) });
  const data = await res.json();
  assertEquals(data.ok, true);
  assertEquals(data.versions.length, 2);
});

Deno.test("GET /api/previews/:id/versions returns 401 without auth", async () => {
  const { app } = createTestApp();
  const { token } = await login(app);
  const id = await setupVersionedPreview(app, token);
  assertEquals((await app.request(`/api/previews/${id}/versions`)).status, 401);
});

Deno.test("GET /api/previews/:id/versions/tagged returns empty list when none tagged", async () => {
  const { app } = createTestApp();
  const { token } = await login(app);
  const id = await setupVersionedPreview(app, token);

  const res = await app.request(`/api/previews/${id}/versions?tagged=1`, { headers: authHeaders(token) });
  const data = await res.json();
  assertEquals(data.ok, true);
  assertEquals(data.versions.length, 0);
});

Deno.test("POST /api/previews/:id/versions/:vId/tag tags a version", async () => {
  const { app, db } = createTestApp();
  const { token } = await login(app);
  const id = await setupVersionedPreview(app, token);
  const versionId = db.listVersions(id)[0].id;

  const res = await app.request(`/api/previews/${id}/versions/${versionId}/tag`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders(token) },
    body: JSON.stringify({ tag: "v1" }),
  });
  assertEquals((await res.json()).ok, true);
  assertEquals(db.getVersion(versionId)?.tag, "v1");
});

Deno.test("POST .../tag makes tagged version visible in /tagged endpoint", async () => {
  const { app, db } = createTestApp();
  const { token } = await login(app);
  const id = await setupVersionedPreview(app, token);
  const versionId = db.listVersions(id)[0].id;

  await app.request(`/api/previews/${id}/versions/${versionId}/tag`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders(token) },
    body: JSON.stringify({ tag: "release" }),
  });

  const res = await app.request(`/api/previews/${id}/versions?tagged=1`, { headers: authHeaders(token) });
  const data = await res.json();
  assertEquals(data.versions.length, 1);
  assertEquals(data.versions[0].tag, "release");
});

Deno.test("POST .../tag returns 400 for empty tag", async () => {
  const { app, db } = createTestApp();
  const { token } = await login(app);
  const id = await setupVersionedPreview(app, token);
  const versionId = db.listVersions(id)[0].id;

  const res = await app.request(`/api/previews/${id}/versions/${versionId}/tag`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders(token) },
    body: JSON.stringify({ tag: "" }),
  });
  assertEquals(res.status, 400);
});

Deno.test("DELETE .../tag removes the tag from a version", async () => {
  const { app, db } = createTestApp();
  const { token } = await login(app);
  const id = await setupVersionedPreview(app, token);
  const versionId = db.listVersions(id)[0].id;

  await app.request(`/api/previews/${id}/versions/${versionId}/tag`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders(token) },
    body: JSON.stringify({ tag: "v1" }),
  });

  const res = await app.request(`/api/previews/${id}/versions/${versionId}/tag`, {
    method: "DELETE",
    headers: authHeaders(token),
  });
  assertEquals((await res.json()).ok, true);
  assertEquals(db.getVersion(versionId)?.tag, null);
});

Deno.test("GET /api/previews/:id/versions/:vId returns html_content", async () => {
  const { app, db } = createTestApp();
  const { token } = await login(app);
  const id = await setupVersionedPreview(app, token);
  const versionId = db.listVersions(id)[0].id;

  const res = await app.request(`/api/previews/${id}/versions/${versionId}`, { headers: authHeaders(token) });
  const data = await res.json();
  assertEquals(data.ok, true);
  assertExists(data.version.html_content);
  assertEquals(data.version.id, versionId);
});

Deno.test("GET .../versions/:vId returns 404 for unknown version", async () => {
  const { app } = createTestApp();
  const { token } = await login(app);
  const id = await createPreview(app, token);
  assertEquals(
    (await app.request(`/api/previews/${id}/versions/99999`, { headers: authHeaders(token) })).status,
    404,
  );
});

// ---- Notes ----

Deno.test("POST /api/previews/:id/notes adds a note", async () => {
  const { app, db } = createTestApp();
  const { token } = await login(app);
  const id = await createPreview(app, token);

  const res = await app.request(`/api/previews/${id}/notes`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders(token) },
    body: JSON.stringify({ author_name: "alice", comment: "looks good" }),
  });
  assertEquals((await res.json()).ok, true);
  assertEquals(db.listNotes(id).length, 1);
  assertEquals(db.listNotes(id)[0].comment, "looks good");
});

Deno.test("POST /api/previews/:id/notes returns 400 with empty comment", async () => {
  const { app } = createTestApp();
  const { token } = await login(app);
  const id = await createPreview(app, token);

  const res = await app.request(`/api/previews/${id}/notes`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders(token) },
    body: JSON.stringify({ author_name: "alice", comment: "" }),
  });
  assertEquals(res.status, 400);
});

Deno.test("POST /api/previews/:id/notes with update_status changes status", async () => {
  const { app, db } = createTestApp();
  const { token } = await login(app);
  const id = await createPreview(app, token);

  await app.request(`/api/previews/${id}/notes`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders(token) },
    body: JSON.stringify({ author_name: "alice", comment: "approving", update_status: "Approved" }),
  });
  assertEquals(db.getPreview(id)?.status, "Approved");
});

Deno.test("PUT /api/notes/:noteId updates a note", async () => {
  const { app, db } = createTestApp();
  const { token } = await login(app);
  const id = await createPreview(app, token);

  await app.request(`/api/previews/${id}/notes`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders(token) },
    body: JSON.stringify({ author_name: "a", comment: "original" }),
  });
  const noteId = db.listNotes(id)[0].id;

  const res = await app.request(`/api/notes/${noteId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...authHeaders(token) },
    body: JSON.stringify({ author_name: "b", comment: "updated" }),
  });
  assertEquals((await res.json()).ok, true);
  assertEquals(db.listNotes(id)[0].comment, "updated");
});

Deno.test("PUT /api/notes/:noteId returns 400 with missing fields", async () => {
  const { app } = createTestApp();
  const { token } = await login(app);

  const res = await app.request("/api/notes/1", {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...authHeaders(token) },
    body: JSON.stringify({ author_name: "", comment: "" }),
  });
  assertEquals(res.status, 400);
});

Deno.test("DELETE /api/notes/:noteId removes the note", async () => {
  const { app, db } = createTestApp();
  const { token } = await login(app);
  const id = await createPreview(app, token);

  await app.request(`/api/previews/${id}/notes`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders(token) },
    body: JSON.stringify({ author_name: "a", comment: "bye" }),
  });
  const noteId = db.listNotes(id)[0].id;

  await app.request(`/api/notes/${noteId}`, { method: "DELETE", headers: authHeaders(token) });
  assertEquals(db.listNotes(id).length, 0);
});

Deno.test("DELETE /api/notes/:noteId returns 401 without auth", async () => {
  const { app, db } = createTestApp();
  const { token } = await login(app);
  const id = await createPreview(app, token);
  await app.request(`/api/previews/${id}/notes`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders(token) },
    body: JSON.stringify({ author_name: "a", comment: "x" }),
  });
  const noteId = db.listNotes(id)[0].id;

  assertEquals((await app.request(`/api/notes/${noteId}`, { method: "DELETE" })).status, 401);
});

// ---- Admin ----

Deno.test("POST /api/admin/password changes the global password", async () => {
  const { app, db } = createTestApp();
  const { token } = await login(app);

  const res = await app.request("/api/admin/password", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders(token) },
    body: JSON.stringify({ password: "new-pass-123", confirm: "new-pass-123" }),
  });
  assertEquals((await res.json()).ok, true);
  assertEquals(db.getSetting("global_password"), "new-pass-123");
});

Deno.test("POST /api/admin/password returns 400 for mismatched passwords", async () => {
  const { app } = createTestApp();
  const { token } = await login(app);

  const res = await app.request("/api/admin/password", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders(token) },
    body: JSON.stringify({ password: "abc123", confirm: "xyz456" }),
  });
  assertEquals(res.status, 400);
});

Deno.test("POST /api/admin/password returns 400 for passwords under 6 chars", async () => {
  const { app } = createTestApp();
  const { token } = await login(app);

  const res = await app.request("/api/admin/password", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders(token) },
    body: JSON.stringify({ password: "abc", confirm: "abc" }),
  });
  assertEquals(res.status, 400);
});

Deno.test("POST /api/admin/password clears all sessions", async () => {
  const { app } = createTestApp();
  const { token } = await login(app);

  await app.request("/api/admin/password", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders(token) },
    body: JSON.stringify({ password: "fresh-pass", confirm: "fresh-pass" }),
  });

  // Old token should no longer work
  assertEquals((await app.request("/api/auth/me", { headers: authHeaders(token) })).status, 401);
});

Deno.test("POST /api/admin/password returns 401 without auth", async () => {
  const { app } = createTestApp();
  const res = await app.request("/api/admin/password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: "abc123!", confirm: "abc123!" }),
  });
  assertEquals(res.status, 401);
});
