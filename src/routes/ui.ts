import { Hono } from "https://deno.land/x/hono@v4.3.11/mod.ts";
import { PreviewDB } from "../db/sql.ts";
import { layout } from "../lib/html.ts";
import { requireAuth } from "../lib/auth.ts";
import { renderTemplate } from "../lib/pug.ts";

const STATUS_OPTIONS = ["All", "Draft", "In Review", "Approved", "Rejected"];
const SORT_OPTIONS = [
  { value: "updated_desc", label: "Last updated (newest)" },
  { value: "updated_asc", label: "Last updated (oldest)" },
  { value: "created_desc", label: "Created (newest)" },
  { value: "created_asc", label: "Created (oldest)" },
];

const formatDate = (value?: string | null) => (value ? value.split("T")[0] : "");

const formatRelativeTime = (value?: string | null) => {
  if (!value) return "";
  const target = new Date(value).getTime();
  const now = Date.now();
  const diff = Math.floor((now - target) / 1000);
  if (diff < 5) return "Just now";
  const units = [
    { label: "year", seconds: 31536000 },
    { label: "month", seconds: 2592000 },
    { label: "week", seconds: 604800 },
    { label: "day", seconds: 86400 },
    { label: "hour", seconds: 3600 },
    { label: "minute", seconds: 60 },
  ];
  for (const unit of units) {
    if (diff >= unit.seconds) {
      const val = Math.floor(diff / unit.seconds);
      return `${val} ${unit.label}${val === 1 ? "" : "s"} ago`;
    }
  }
  return `${diff} seconds ago`;
};

export function createUiRouter(db: PreviewDB) {
  const ui = new Hono();

  ui.get("/", (c) => {
    const destination = c.req.query("destination") || "";
    const body = renderTemplate("login.pug", { destination });
    return c.html(layout({ title: "Login – preview", body, active: "login" }));
  });

  ui.get("/dashboard", (c) => {
    const auth = requireAuth(db, c.req.raw);
    if (!auth) return c.redirect("/?destination=dashboard");

    const status = c.req.query("status") || "All";
    const sort = c.req.query("sort") || "updated_desc";
    const previews = db.listPreviews({ status, sort }).map((p) => ({ ...p, updatedOn: formatDate(p.updated_at) }));
    const body = renderTemplate("dashboard.pug", {
      status,
      sort,
      previews,
      statusOptions: STATUS_OPTIONS,
      sortOptions: SORT_OPTIONS,
      userName: auth.name,
    });
    return c.html(layout({ title: "Dashboard – preview", userName: auth.name, body, active: "dashboard" }));
  });

  ui.get("/dashboard/partial/grid", (c) => {
    const auth = requireAuth(db, c.req.raw);
    if (!auth) return c.text("Unauthorized", 401);

    const status = c.req.query("status") || "All";
    const sort = c.req.query("sort") || "updated_desc";
    const previews = db.listPreviews({ status, sort }).map((p) => ({ ...p, updatedOn: formatDate(p.updated_at) }));
    return c.html(renderTemplate("partials/preview-grid.pug", { previews }));
  });

  ui.get("/preview/:id", (c) => {
    const auth = requireAuth(db, c.req.raw);
    const id = Number(c.req.param("id"));
    if (!auth) return c.redirect(`/?destination=${encodeURIComponent(String(id))}`);

    const preview = db.getPreview(id);
    if (!preview) return c.notFound();

    const tab = c.req.query("tab") || "view";
    const noteCountNumber = db.countNotes(id);
    const badgeCount = noteCountNumber > 9 ? "9+" : String(noteCountNumber);
    const previewView = {
      ...preview,
      updatedOn: formatDate(preview.updated_at),
      typeLabel: preview.type,
      noteCount: badgeCount,
      noteCountNumber,
      notesCTA: "See notes",
    };
    const body = renderTemplate("preview.pug", { preview: previewView, tab, userName: auth.name });
    return c.html(layout({ title: `${preview.title} – preview`, userName: auth.name, body, active: "preview" }));
  });

  ui.get("/preview/:id/partial/notes", (c) => {
    const auth = requireAuth(db, c.req.raw);
    if (!auth) return c.text("Unauthorized", 401);

    const id = Number(c.req.param("id"));
    const notes = db.listNotes(id).map((note) => ({ ...note, createdOn: formatRelativeTime(note.created_at) }));
    if (notes.length === 0) return c.html("<p>No notes yet.</p>");
    return c.html(renderTemplate("partials/notes-list.pug", { notes }));
  });

  ui.get("/admin", (c) => {
    const auth = requireAuth(db, c.req.raw);
    if (!auth) return c.redirect("/?destination=admin");

    const stats = db.getStats();
    const current = db.getSetting("global_password") ? "(set in admin)" : "(using env)";
    const body = renderTemplate("admin.pug", { stats, current });
    return c.html(layout({ title: "Admin – preview", userName: auth.name, body, active: "admin" }));
  });

  return ui;
}
