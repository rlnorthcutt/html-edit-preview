# TODO

Improvements identified during code review, not yet implemented.

## #1 — Add-note + status update is not atomic

**Files:** `src/routes/api.ts:107-120`

`addNote` and `updatePreviewMeta` are called sequentially with no transaction. If the second call fails, the note exists but the status didn't change.

Wrap both operations in a SQLite transaction. Add a transaction helper to `PreviewDB` or use `DatabaseSync` `exec` with `BEGIN`/`COMMIT`.

---

## #2 — Forms can double-submit

**Files:** `static/app.js:212-235` (create preview), `static/app.js:238-267` (admin password)

No button-disable during async POST. On a slow connection a user can click multiple times, creating duplicate previews or firing the password update twice.

Disable the submit button on click, re-enable on completion (success or error).

---

## #3 — Status and type options are hardcoded in multiple places

**Files:** `src/routes/ui.ts:7-13`, `src/templates/partials/meta-modal.pug`, `src/templates/partials/add-note-modal.pug`

Status values (`Draft`, `In Review`, `Approved`, `Rejected`) and type values (`Mockup`, `Email`, `Landing`, `Other`) are defined independently in TypeScript and repeated verbatim in two Pug templates. Adding or renaming a status requires changes in all three places.

Define the arrays once in `ui.ts` (or a shared constants file) and pass them as template locals to every route that renders a form.

---

## #4 — Modals have no mobile breakpoint

**Files:** `static/app.css:105-108`

`dialog { width: 50%; min-width: 30rem; }` means dialogs can be wider than the viewport on small screens.

Add a media query:

```css
@media (max-width: 640px) {
  dialog {
    width: 92vw;
    min-width: unset;
  }
}
```
