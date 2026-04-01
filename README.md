# HTML Edit & Preview

A lightweight HTML preview and review tool. Create, edit, and annotate HTML mockups with a live preview, status tracking, collaborative notes, and version history.

Built with [Deno](https://deno.land), [Hono](https://hono.dev), [Pug](https://pugjs.org) templates, and SQLite via `node:sqlite`.

## Features

- Live HTML editor with real-time split-pane preview
- Version history — last 5 saves kept automatically; tag any version (e.g. `v1`, `v2`) to keep it permanently
- Status workflow: Draft → In Review → Approved / Rejected
- Per-preview notes with author names
- Session-based auth with a shared password
- Admin panel for password management and stats

## Routes

| Path | Description |
|------|-------------|
| `GET /` | Login page |
| `GET /dashboard` | Preview grid with filter/sort |
| `GET /preview/:id` | View / edit a single preview |
| `GET /admin` | Admin panel |
| `POST /api/auth/login` | Authenticate |
| `POST /api/previews` | Create a preview |
| `PUT /api/previews/:id/html` | Save HTML content (also saves a version) |
| `PUT /api/previews/:id/meta` | Update title, status, etc. |
| `GET /api/previews/:id/versions` | List versions (add `?tagged=1` for tagged only) |
| `GET /api/previews/:id/versions/:vId` | Get a single version's HTML |
| `POST /api/previews/:id/versions/:vId/tag` | Tag a version |
| `DELETE /api/previews/:id/versions/:vId/tag` | Remove a version's tag |
| `POST /api/previews/:id/notes` | Add a note |
| `DELETE /api/previews/:id` | Delete a preview |

## Development

Requires Deno 2.x.

```sh
# Start with file-watching
deno task dev

# Run tests
deno task test
```

The app listens on `http://localhost:8000` by default. Data is stored in `./data/preview.db`.

**Default password:** `s@mpl3-p@ssw0rd` (override with the `PREVIEW_PASSWORD` env var, or change it in the Admin panel once logged in).

## Deployment (Smallweb)

This app is designed to live inside a [Smallweb](https://smallweb.run) installation. Smallweb serves it automatically by running `main.ts` via Deno.

```
~/smallweb/
└── preview/          ← this repo
    ├── main.ts
    ├── src/
    └── static/
```

Smallweb sets `SMALLWEB_DATA_DIR` to a per-app data directory. The app uses that path for the SQLite database; locally it falls back to `./data/`.

**Important:** always run or invoke the app with the repo root as the working directory. `static/` files are served relative to `Deno.cwd()`, so the CWD must be the app folder — both locally and in Smallweb (which does this automatically).

To set a custom password at deploy time, set the `PREVIEW_PASSWORD` environment variable in your Smallweb app config.

## Project Structure

```
main.ts                   Entry point — wires Hono app, DB, and routes
src/
  db/sql.ts               PreviewDB class — all SQLite queries
  routes/
    ui.ts                 Server-rendered page routes (Pug)
    api.ts                JSON API routes
  lib/
    auth.ts               Session auth helpers
    html.ts               Layout wrapper
    pug.ts                Pug template renderer
    utils.ts              Shared utilities (tokens, text sanitization)
  files.ts                Static file router
  templates/              Pug templates
static/                   Pre-built CSS and JS assets
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `SMALLWEB_DATA_DIR` | `./data` | Directory for the SQLite database |
| `PREVIEW_PASSWORD` | `s@mpl3-p@ssw0rd` | Login password (overridden by admin panel setting) |
