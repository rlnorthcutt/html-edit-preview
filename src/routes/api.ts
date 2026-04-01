import { Hono } from "https://deno.land/x/hono@v4.3.11/mod.ts";
import { PreviewDB } from "../db/sql.ts";
import { getEffectivePassword, requireAuth } from "../lib/auth.ts";
import { clampText, randomToken, safeText } from "../lib/utils.ts";

export function createApiRouter(db: PreviewDB) {
  const api = new Hono();

  // ---------- Auth ----------
  api.post("/auth/login", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const name = safeText(body.name);
    const password = safeText(body.password);
    const destination = safeText(body.destination);

    if (!name) return c.json({ ok: false, error: "Name is required." }, 400);

    const expected = getEffectivePassword(db);
    if (!password || password !== expected) {
      return c.json({ ok: false, error: "Invalid password." }, 401);
    }

    const expires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const token = randomToken();
    db.createSession(token, name, expires);
    c.header("Set-Cookie", `preview_token=${token}; Path=/; Max-Age=${24 * 60 * 60}; HttpOnly; SameSite=Lax`);

    return c.json({
      ok: true,
      token,
      name,
      expires_at: expires,
      redirect_to: destination ? resolveDestination(destination) : "/dashboard",
    });
  });

  api.post("/auth/logout", (c) => {
    const auth = requireAuth(db, c.req.raw);
    if (auth) db.deleteSession(auth.token);
    c.header("Set-Cookie", "preview_token=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax");
    return c.json({ ok: true });
  });

  api.get("/auth/me", (c) => {
    const auth = requireAuth(db, c.req.raw);
    if (!auth) return c.json({ ok: false }, 401);
    return c.json({ ok: true, name: auth.name });
  });

  // ---------- Previews ----------
  api.post("/previews", async (c) => {
    const auth = requireAuth(db, c.req.raw);
    if (!auth) return c.json({ ok: false }, 401);

    const body = await c.req.json().catch(() => ({}));
    const id = db.createPreview({
      title: safeText(body.title),
      description: safeText(body.description),
      status: safeText(body.status || "Draft"),
      type: safeText(body.type || "Mockup"),
      owner: safeText(body.owner || auth.name),
    });
    return c.json({ ok: true, id });
  });

  api.put("/previews/:id/html", async (c) => {
    const auth = requireAuth(db, c.req.raw);
    if (!auth) return c.json({ ok: false }, 401);

    const id = Number(c.req.param("id"));
    const body = await c.req.json().catch(() => ({}));
    const html = String(body.html ?? "");
    if (html.length > 1_000_000) {
      return c.json({ ok: false, error: "HTML content exceeds 1 MB limit." }, 413);
    }
    db.updatePreviewHtml(id, html);
    db.saveVersion(id, html);
    return c.json({ ok: true });
  });

  api.put("/previews/:id/meta", async (c) => {
    const auth = requireAuth(db, c.req.raw);
    if (!auth) return c.json({ ok: false }, 401);

    const id = Number(c.req.param("id"));
    const body = await c.req.json().catch(() => ({}));
    db.updatePreviewMeta(id, {
      title: safeText(body.title),
      description: safeText(body.description),
      status: safeText(body.status),
      type: safeText(body.type),
      owner: safeText(body.owner || auth.name),
    });
    return c.json({ ok: true });
  });

  // ---------- Versions ----------
  api.get("/previews/:id/versions", (c) => {
    const auth = requireAuth(db, c.req.raw);
    if (!auth) return c.json({ ok: false }, 401);
    const id = Number(c.req.param("id"));
    const tagged = c.req.query("tagged") === "1";
    const versions = tagged ? db.listTaggedVersions(id) : db.listVersions(id);
    return c.json({ ok: true, versions });
  });

  api.get("/previews/:id/versions/:versionId", (c) => {
    const auth = requireAuth(db, c.req.raw);
    if (!auth) return c.json({ ok: false }, 401);
    const versionId = Number(c.req.param("versionId"));
    const version = db.getVersion(versionId);
    if (!version) return c.json({ ok: false }, 404);
    return c.json({ ok: true, version });
  });

  api.post("/previews/:id/versions/:versionId/tag", async (c) => {
    const auth = requireAuth(db, c.req.raw);
    if (!auth) return c.json({ ok: false }, 401);
    const versionId = Number(c.req.param("versionId"));
    const body = await c.req.json().catch(() => ({}));
    const tag = safeText(body.tag);
    if (!tag) return c.json({ ok: false, error: "Tag is required." }, 400);
    db.tagVersion(versionId, tag);
    return c.json({ ok: true });
  });

  api.delete("/previews/:id/versions/:versionId/tag", (c) => {
    const auth = requireAuth(db, c.req.raw);
    if (!auth) return c.json({ ok: false }, 401);
    const versionId = Number(c.req.param("versionId"));
    db.removeVersionTag(versionId);
    return c.json({ ok: true });
  });

  // ---------- Notes ----------
  api.post("/previews/:id/notes", async (c) => {
    const auth = requireAuth(db, c.req.raw);
    if (!auth) return c.json({ ok: false }, 401);

    const previewId = Number(c.req.param("id"));
    const body = await c.req.json().catch(() => ({}));

    const author = safeText(body.author_name || auth.name);
    const comment = clampText(safeText(body.comment), 20000);
    const updateStatus = safeText(body.update_status || "");

    if (!comment) return c.json({ ok: false, error: "Comment is required." }, 400);

    db.addNote(previewId, author, comment);

    if (updateStatus) {
      const p = db.getPreview(previewId);
      if (p) {
        db.updatePreviewMeta(previewId, {
          title: p.title,
          description: p.description,
          status: updateStatus,
          type: p.type,
          owner: p.owner,
        });
      }
    }

    return c.json({ ok: true });
  });

  api.delete("/notes/:noteId", (c) => {
    const auth = requireAuth(db, c.req.raw);
    if (!auth) return c.json({ ok: false }, 401);

    const noteId = Number(c.req.param("noteId"));
    db.deleteNote(noteId);
    return c.json({ ok: true });
  });

  api.put("/notes/:noteId", async (c) => {
    const auth = requireAuth(db, c.req.raw);
    if (!auth) return c.json({ ok: false }, 401);

    const noteId = Number(c.req.param("noteId"));
    if (!Number.isFinite(noteId)) return c.json({ ok: false }, 400);

    const body = await c.req.json().catch(() => ({}));
    const name = safeText(body.author_name);
    const comment = safeText(body.comment);
    if (!name || !comment) return c.json({ ok: false, error: "Name and comment required." }, 400);

    db.updateNote(noteId, name, comment);
    return c.json({ ok: true });
  });

  // ---------- Admin ----------
  api.post("/admin/password", async (c) => {
    const auth = requireAuth(db, c.req.raw);
    if (!auth) return c.json({ ok: false }, 401);

    const body = await c.req.json().catch(() => ({}));
    const pw = safeText(body.password);
    const confirm = safeText(body.confirm);

    if (pw.length < 6) return c.json({ ok: false, error: "Password must be at least 6 characters." }, 400);
    if (pw !== confirm) return c.json({ ok: false, error: "Passwords do not match." }, 400);

    db.setSetting("global_password", pw);
    db.clearAllSessions();
    c.header("Set-Cookie", "preview_token=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax");
    return c.json({ ok: true });
  });

  api.delete("/previews/:id", (c) => {
    const auth = requireAuth(db, c.req.raw);
    if (!auth) return c.json({ ok: false }, 401);

    const id = Number(c.req.param("id"));
    if (!Number.isFinite(id)) return c.json({ ok: false }, 400);

    db.deletePreview(id);
    return c.json({ ok: true });
  });

  return api;
}

function resolveDestination(dest: string): string {
  if (dest === "dashboard") return "/dashboard";
  if (dest === "admin") return "/admin";

  const maybeId = Number(dest);
  if (Number.isFinite(maybeId) && maybeId > 0) return `/preview/${maybeId}`;

  return "/dashboard";
}
