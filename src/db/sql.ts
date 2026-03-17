import { DatabaseSync } from "node:sqlite";
import { nowIso, safeText } from "../lib/utils.ts";

export type PreviewStatus = "Draft" | "In Review" | "Approved" | "Rejected";
export type PreviewType = "Mockup" | "Email" | "Landing" | "Other";

export type Preview = {
  id: number;
  title: string;
  description: string;
  html_content: string;
  status: PreviewStatus;
  type: PreviewType;
  owner: string;
  created_at: string;
  updated_at: string;
};

export type Note = {
  id: number;
  preview_id: number;
  author_name: string;
  comment: string;
  created_at: string;
};

type SessionRow = {
  token: string;
  name: string;
  expires_at: string;
  created_at: string;
};

export class PreviewDB {
  private db: DatabaseSync;

  constructor(dbPath: string) {
    this.db = new DatabaseSync(dbPath);
    this.init();
  }

  private init() {
    this.db.exec(`
      PRAGMA journal_mode=WAL;

      CREATE TABLE IF NOT EXISTS previews (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        html_content TEXT NOT NULL,
        status TEXT NOT NULL,
        type TEXT NOT NULL,
        owner TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS notes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        preview_id INTEGER NOT NULL,
        author_name TEXT NOT NULL,
        comment TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY(preview_id) REFERENCES previews(id) ON DELETE CASCADE
      ) STRICT;

      CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
    `);

    const columns = this.db.prepare(`PRAGMA table_info(previews)`).all() as Array<{ name: string }>;
    if (!columns.some((col) => col.name === "owner")) {
      this.db.exec(`ALTER TABLE previews ADD COLUMN owner TEXT NOT NULL DEFAULT ''`);
    }

    // Seed a welcome preview if empty
    const count = this.db.prepare(`SELECT COUNT(*) as c FROM previews`).get() as { c: number };
    if (count.c === 0) {
      const t = nowIso();
      this.db.prepare(`
        INSERT INTO previews (title, description, html_content, status, type, owner, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        "Welcome to HTML Preview",
        "Edit the HTML, see it live, add notes, and approve.",
        `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Welcome</title>
    <style>
      body { font-family: system-ui; padding: 2rem; line-height: 1.4; }
      .box { padding: 1rem; border: 1px solid #ddd; border-radius: 12px; }
      code { background: #f4f4f4; padding: 0.2rem 0.35rem; border-radius: 6px; }
    </style>
  </head>
  <body>
    <h1>HTML Preview</h1>
    <div class="box">
      <p>Click <b>Edit</b> to open the live editor and start typing.</p>
      <p>Tip: use <code>absolute URLs</code> for images and CSS.</p>
    </div>
  </body>
</html>`,
        "Draft",
        "Mockup",
        "System",
        t,
        t,
      );
    }
  }

  // -------- Settings --------
  getSetting(key: string): string | null {
    const row = this.db.prepare(`SELECT value FROM settings WHERE key = ?`).get(key) as
      | { value: string }
      | undefined;
    return row?.value ?? null;
  }

  setSetting(key: string, value: string) {
    const t = nowIso();
    this.db.prepare(`
      INSERT INTO settings (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at
    `).run(key, value, t);
  }

  // -------- Sessions --------
  createSession(token: string, name: string, expiresAtIso: string) {
    this.cleanupExpiredSessions();
    const t = nowIso();
    this.db.prepare(`
      INSERT INTO sessions (token, name, expires_at, created_at)
      VALUES (?, ?, ?, ?)
    `).run(token, safeText(name), expiresAtIso, t);
  }

  getSession(token: string): SessionRow | null {
    const row = this.db.prepare(`
      SELECT token, name, expires_at, created_at FROM sessions WHERE token = ?
    `).get(token) as SessionRow | undefined;
    return row ?? null;
  }

  deleteSession(token: string) {
    this.db.prepare(`DELETE FROM sessions WHERE token = ?`).run(token);
  }

  clearAllSessions() {
    this.db.prepare(`DELETE FROM sessions`).run();
  }

  cleanupExpiredSessions() {
    const now = nowIso();
    this.db.prepare(`DELETE FROM sessions WHERE expires_at < ?`).run(now);
  }

  // -------- Previews --------
  listPreviews(params: { status?: string; sort?: string }): Preview[] {
    const where: string[] = [];
    const binds: Array<string | number> = [];

    if (params.status && params.status !== "All") {
      where.push("status = ?");
      binds.push(params.status);
    }

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    let orderBy = "updated_at DESC";
    if (params.sort === "created_desc") orderBy = "created_at DESC";
    if (params.sort === "created_asc") orderBy = "created_at ASC";
    if (params.sort === "updated_asc") orderBy = "updated_at ASC";

    const sql = `
      SELECT id, title, description, html_content, status, type, owner, created_at, updated_at
      FROM previews
      ${whereSql}
      ORDER BY ${orderBy}
    `;
    return this.db.prepare(sql).all(...binds) as Preview[];
  }

  getPreview(id: number): Preview | null {
    const row = this.db.prepare(`
      SELECT id, title, description, html_content, status, type, owner, created_at, updated_at
      FROM previews WHERE id = ?
    `).get(id) as Preview | undefined;
    return row ?? null;
  }

  createPreview(input: { title: string; description: string; status: string; type: string; owner: string }): number {
    const t = nowIso();
    const result = this.db.prepare(`
      INSERT INTO previews (title, description, html_content, status, type, owner, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      safeText(input.title),
      safeText(input.description),
      "<!doctype html>\n<html>\n  <head>\n    <meta charset=\"utf-8\" />\n    <title>New Preview</title>\n  </head>\n  <body>\n    <h1>Hello</h1>\n  </body>\n</html>\n",
      safeText(input.status),
      safeText(input.type),
      safeText(input.owner),
      t,
      t,
    );
    // node:sqlite returns lastInsertRowid on the statement object
    const anyRes = result as { lastInsertRowid?: number };
    return Number(anyRes.lastInsertRowid);
  }

  updatePreviewMeta(id: number, input: { title: string; description: string; status: string; type: string; owner: string }) {
    const t = nowIso();
    this.db.prepare(`
      UPDATE previews
      SET title=?, description=?, status=?, type=?, owner=?, updated_at=?
      WHERE id=?
    `).run(
      safeText(input.title),
      safeText(input.description),
      safeText(input.status),
      safeText(input.type),
      safeText(input.owner),
      t,
      id,
    );
  }

  updatePreviewHtml(id: number, html: string) {
    const t = nowIso();
    this.db.prepare(`
      UPDATE previews
      SET html_content=?, updated_at=?
      WHERE id=?
    `).run(html, t, id);
  }

  // -------- Notes --------
  countNotes(previewId: number): number {
    const row = this.db.prepare(`SELECT COUNT(*) as c FROM notes WHERE preview_id = ?`).get(previewId) as { c: number };
    return row.c;
  }

  listNotes(previewId: number): Note[] {
    return this.db.prepare(`
      SELECT id, preview_id, author_name, comment, created_at
      FROM notes
      WHERE preview_id = ?
      ORDER BY created_at DESC
    `).all(previewId) as Note[];
  }

  addNote(previewId: number, authorName: string, comment: string) {
    const t = nowIso();
    this.db.prepare(`
      INSERT INTO notes (preview_id, author_name, comment, created_at)
      VALUES (?, ?, ?, ?)
    `).run(previewId, safeText(authorName), safeText(comment), t);
  }

  updateNote(noteId: number, authorName: string, comment: string) {
    this.db.prepare(`
      UPDATE notes
      SET author_name = ?, comment = ?
      WHERE id = ?
    `).run(safeText(authorName), safeText(comment), noteId);
  }

  deleteNote(noteId: number) {
    this.db.prepare(`DELETE FROM notes WHERE id = ?`).run(noteId);
  }

  // -------- Stats --------
  getStats() {
    const previews = this.db.prepare(`SELECT COUNT(*) as c FROM previews`).get() as { c: number };
    const notes = this.db.prepare(`SELECT COUNT(*) as c FROM notes`).get() as { c: number };
    const sessions = this.db.prepare(`SELECT COUNT(*) as c FROM sessions`).get() as { c: number };
    return { previews: previews.c, notes: notes.c, sessions: sessions.c };
  }
  deletePreview(id: number) {
    this.db.prepare(`DELETE FROM previews WHERE id = ?`).run(id);
  }
}
