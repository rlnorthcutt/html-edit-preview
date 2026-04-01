// preview client runtime:
// - localStorage session { token, name, expires_at }
// - attach token to all fetch + HTMX requests via header
// - modal handling
// - Monaco editor init (if in edit mode), auto-preview, unsaved ribbon
// - notes sidebar + double-confirm delete

const STORAGE_KEY = "preview.session";

function getSession() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (!s?.token || !s?.expires_at) return null;
    if (new Date(s.expires_at).getTime() < Date.now()) {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return s;
  } catch {
    return null;
  }
}

function setSession(session) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  try {
    if (session?.name) localStorage.setItem("preview.lastName", session.name);
  } catch (_) {
    // ignore
  }
}

function clearSession() {
  localStorage.removeItem(STORAGE_KEY);
}

function authHeader() {
  const s = getSession();
  return s?.token ? { "X-Session-Token": s.token } : {};
}

function reloadNotes(previewId) {
  if (!window.htmx || !previewId) return;
  window.htmx.ajax("GET", `/preview/${previewId}/partial/notes`, { target: "#notesList" });
}

function setNotesCount(count) {
  const btn = document.querySelector('[data-notes-button]');
  if (!btn) return;
  const safe = Math.max(0, count);
  btn.dataset.noteCount = String(safe);
  let badge = btn.querySelector('.notes-badge');
  if (safe > 0) {
    const text = safe > 9 ? '9+' : String(safe);
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'notes-badge';
      btn.appendChild(badge);
    }
    badge.textContent = text;
  } else if (badge) {
    badge.remove();
  }
}

function adjustNotesCount(delta) {
  const btn = document.querySelector('[data-notes-button]');
  if (!btn) return;
  const current = Number(btn.dataset.noteCount || '0');
  setNotesCount(current + delta);
}

function updateIframeHeight(frame) {
  if (!frame) return;
  try {
    const doc = frame.contentDocument || frame.contentWindow?.document;
    const height = doc?.documentElement?.scrollHeight;
    if (height) frame.style.height = `${height}px`;
  } catch (_) {
    // ignore cross-origin issues
  }
}

function ensureIframeAutoResize(frame) {
  if (!frame || frame.__hapAutoResizeAttached) return;
  frame.__hapAutoResizeAttached = true;
  frame.addEventListener("load", () => requestAnimationFrame(() => updateIframeHeight(frame)));
  requestAnimationFrame(() => updateIframeHeight(frame));
}

// HTMX: attach auth header to all requests
document.body.addEventListener("htmx:configRequest", (evt) => {
  const s = getSession();
  if (s?.token) evt.detail.headers["X-Session-Token"] = s.token;
});

// ---------- Modal helpers ----------
function openModal(id) {
  const el = document.getElementById(id);
  if (!el) return;
  if (el instanceof HTMLDialogElement) {
    if (!el.open) el.showModal();
    return;
  }
  el.hidden = false;
  el.classList.add("is-open");
  requestAnimationFrame(() => el.classList.add("is-ready"));
}

function closeModal(id) {
  const el = document.getElementById(id);
  if (!el) return;
  if (el instanceof HTMLDialogElement) {
    if (el.open) el.close();
    return;
  }
  el.classList.remove("is-ready");
  setTimeout(() => {
    el.hidden = true;
    el.classList.remove("is-open");
  }, 150);
}

document.addEventListener("click", (e) => {
  const target = e.target instanceof Element ? e.target : null;
  const openTrigger = target?.closest('[data-modal-open]');
  if (openTrigger) {
    const id = openTrigger.getAttribute('data-modal-open');
    if (id) return openModal(id);
  }

  const closeTrigger = target?.closest('[data-modal-close]');
  if (closeTrigger) {
    const id = closeTrigger.getAttribute('data-modal-close');
    if (id) return closeModal(id);
  }

  if (target instanceof HTMLDialogElement && !target.hasAttribute('data-ignore-backdrop')) {
    target.close();
  }
});

// ---------- Logout ----------
document.addEventListener("click", async (e) => {
  const target = e.target instanceof Element ? e.target : null;
  const editBtn = target?.closest('[data-action="editNote"]');
  if (editBtn) {
    const form = document.getElementById("editNoteForm");
    if (form) {
      form.dataset.noteId = editBtn.getAttribute("data-note-id") || "";
      form.dataset.previewId = editBtn.getAttribute("data-preview-id") || "";
      form.querySelector('[name="author_name"]').value = editBtn.getAttribute("data-author") || "";
      form.querySelector('[name="comment"]').value = editBtn.getAttribute("data-comment") || "";
      openModal("editNoteModal");
    }
    return;
  }
  const btn = target?.closest('[data-action="logout"]');
  if (!btn) return;

  try {
    await fetch("/api/auth/logout", { method: "POST", headers: { ...authHeader() } });
  } finally {
    clearSession();
    window.location.href = "/";
  }
});

// ---------- Login ----------
const loginForm = document.getElementById("loginForm");
if (loginForm) {
  const savedName = localStorage.getItem("preview.lastName");
  if (savedName) {
    const nameInput = document.getElementById("loginName");
    if (nameInput) nameInput.value = savedName;
  }
  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(loginForm);
    const payload = {
      name: String(fd.get("name") || ""),
      password: String(fd.get("password") || ""),
      destination: String(fd.get("destination") || ""),
    };

    const errEl = document.getElementById("loginError");
    if (errEl) errEl.hidden = true;

    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = await res.json().catch(() => ({}));
    if (!data.ok) {
      if (errEl) {
        errEl.textContent = data.error || "Login failed.";
        errEl.hidden = false;
      }
      return;
    }

    setSession({ token: data.token, name: data.name, expires_at: data.expires_at });
    window.location.href = data.redirect_to || "/dashboard";
  });
}

// ---------- Dashboard: create preview ----------
const newPreviewForm = document.getElementById("newPreviewForm");
if (newPreviewForm) {
  newPreviewForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(newPreviewForm);
    const payload = {
      title: String(fd.get("title") || ""),
      description: String(fd.get("description") || ""),
      status: String(fd.get("status") || "Draft"),
      type: String(fd.get("type") || "Mockup"),
      owner: String(fd.get("owner") || ""),
    };

    const res = await fetch("/api/previews", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeader() },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!data.ok) return;

    window.location.href = `/preview/${data.id}?tab=edit`;
  });
}

// ---------- Admin: password ----------
const adminPasswordForm = document.getElementById("adminPasswordForm");
if (adminPasswordForm) {
  adminPasswordForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(adminPasswordForm);
    const payload = {
      password: String(fd.get("password") || ""),
      confirm: String(fd.get("confirm") || ""),
    };

    const msg = document.getElementById("adminPwMsg");
    if (msg) msg.hidden = true;

    const res = await fetch("/api/admin/password", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeader() },
      body: JSON.stringify(payload),
    });

    const data = await res.json().catch(() => ({}));
    if (msg) {
      msg.textContent = data.ok ? "Updated. You will need to log in again." : (data.error || "Update failed.");
      msg.hidden = false;
    }
    if (data.ok) {
      clearSession();
      setTimeout(() => (window.location.href = "/"), 600);
    }
  });
}

// ---------- Preview page behaviors ----------
let notesOpen = false;
const previewMainId = "previewTools";

function isPreviewMainAligned() {
  const target = document.getElementById(previewMainId);
  if (!target) return true;
  const rect = target.getBoundingClientRect();
  return Math.abs(rect.top) < 6;
}

function scrollPreviewMainIfNeeded() {
  const target = document.getElementById(previewMainId);
  if (!target || isPreviewMainAligned()) return;
  target.scrollIntoView({ behavior: "smooth", block: "start" });
}

document.addEventListener("click", (e) => {
  const target = e.target instanceof Element ? e.target : null;
  const btn = target?.closest('[data-action="toggleNotes"]');
  if (!btn) return;

  scrollPreviewMainIfNeeded();
  const sidebar = document.getElementById("notesSidebar");
  if (!sidebar) return;
  notesOpen = !notesOpen;
  sidebar.hidden = !notesOpen;
  const label = btn.querySelector('[data-note-label]');
  if (label) label.textContent = notesOpen ? "Hide notes" : "See notes";
});

document.addEventListener("click", (e) => {
  const target = e.target instanceof Element ? e.target : null;
  const trigger = target?.closest('[data-preview-scroll="main"]');
  if (!trigger) return;
  scrollPreviewMainIfNeeded();
});

// Double-confirm delete notes
const armed = new Map();
document.addEventListener("click", async (e) => {
  const target = e.target instanceof Element ? e.target : null;
  const btn = target?.closest('[data-action="armDeleteNote"]');
  if (!btn) return;

  const noteId = btn.getAttribute("data-note-id");
  if (!noteId) return;

  const confirmEl = document.getElementById(`noteConfirm-${noteId}`);
  const isArmed = armed.get(noteId);
  const labelSpan = btn.querySelector('[data-label]');

  if (!isArmed) {
    armed.set(noteId, true);
    if (confirmEl) confirmEl.hidden = false;
    if (labelSpan) labelSpan.textContent = "Delete note?";
    btn.classList.add("danger");
    setTimeout(() => {
      armed.delete(noteId);
      if (confirmEl) confirmEl.hidden = true;
      if (labelSpan) labelSpan.textContent = "×";
      btn.classList.remove("danger");
    }, 2500);
    return;
  }

  const res = await fetch(`/api/notes/${noteId}`, {
    method: "DELETE",
    headers: { ...authHeader() },
  });
  const data = await res.json().catch(() => ({}));
  if (data.ok) {
    const container = document.getElementById("notesList");
    const previewId = container?.getAttribute("data-preview-id");
    reloadNotes(previewId || "");
    btn.classList.remove("danger");
    adjustNotesCount(-1);
  }
});

// Delete preview confirmation
const previewDeleteState = new Map();
document.addEventListener("click", async (e) => {
  const target = e.target instanceof Element ? e.target : null;
  const btn = target?.closest('[data-action="confirmDeletePreview"]');
  if (!btn) return;

  const previewId = btn.getAttribute("data-preview-id");
  if (!previewId) return;

  const isArmed = previewDeleteState.get(previewId);
  const labelSpan = btn.querySelector('[data-label]');

  if (!isArmed) {
    previewDeleteState.set(previewId, true);
    if (labelSpan) labelSpan.textContent = "Delete preview?";
    btn.classList.add("danger");
    setTimeout(() => {
      previewDeleteState.delete(previewId);
      if (labelSpan) labelSpan.textContent = "Delete";
      btn.classList.remove("danger");
    }, 2500);
    return;
  }

  const res = await fetch(`/api/previews/${previewId}`, {
    method: "DELETE",
    headers: { ...authHeader() },
  });
  const data = await res.json().catch(() => ({}));
  if (data.ok) {
    window.location.href = "/dashboard";
  }
});

// Add note
const addNoteForm = document.getElementById("addNoteForm");
if (addNoteForm) {
  addNoteForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const previewId = addNoteForm.getAttribute("data-preview-id");
    if (!previewId) return;

    const fd = new FormData(addNoteForm);
    const payload = {
      author_name: String(fd.get("author_name") || ""),
      comment: String(fd.get("comment") || ""),
      update_status: String(fd.get("update_status") || ""),
    };

    const res = await fetch(`/api/previews/${previewId}/notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeader() },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (data.ok) {
      closeModal("addNoteModal");
      addNoteForm.reset();
      reloadNotes(previewId);
      if (payload.update_status) window.location.reload();
      adjustNotesCount(1);
    }
  });
}

const editNoteForm = document.getElementById("editNoteForm");
if (editNoteForm) {
  editNoteForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const noteId = editNoteForm.dataset.noteId;
    const previewId = editNoteForm.dataset.previewId;
    if (!noteId || !previewId) return;

    const fd = new FormData(editNoteForm);
    const payload = {
      author_name: String(fd.get("author_name") || ""),
      comment: String(fd.get("comment") || ""),
    };

    const res = await fetch(`/api/notes/${noteId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...authHeader() },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (data.ok) {
      closeModal("editNoteModal");
      reloadNotes(previewId);
    }
  });
}

// Meta form
const metaForm = document.getElementById("metaForm");
if (metaForm) {
  metaForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const previewId = metaForm.getAttribute("data-preview-id");
    if (!previewId) return;

    const fd = new FormData(metaForm);
    const payload = {
      title: String(fd.get("title") || ""),
      description: String(fd.get("description") || ""),
      status: String(fd.get("status") || ""),
      type: String(fd.get("type") || ""),
      owner: String(fd.get("owner") || ""),
    };

    const res = await fetch(`/api/previews/${previewId}/meta`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...authHeader() },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (data.ok) window.location.reload();
  });
}

// ---------- Live Edit modal ----------
(function () {
  let liveEd = null;
  let liveLastSaved = "";
  let livePreviewId = "";
  let hapDecorations = [];
  let activeTab = "editor";

  function formatDate(iso) {
    try {
      return new Intl.DateTimeFormat(undefined, {
        month: "short", day: "numeric", year: "numeric",
        hour: "2-digit", minute: "2-digit",
      }).format(new Date(iso));
    } catch (_) {
      return iso;
    }
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  async function loadTaggedVersions() {
    if (!livePreviewId) return;
    const res = await fetch(`/api/previews/${livePreviewId}/versions?tagged=1`, {
      headers: { ...authHeader() },
    });
    const data = await res.json().catch(() => ({}));
    const select = document.getElementById("versionTagSelect");
    const createBtn = document.getElementById("versionTagCreate");
    if (!select || !data.ok) return;
    const versions = data.versions || [];
    const hasTagged = versions.length > 0;
    select.hidden = !hasTagged;
    if (createBtn) createBtn.hidden = hasTagged;
    while (select.options.length > 1) select.remove(1);
    for (const v of versions) {
      const opt = document.createElement("option");
      opt.value = String(v.id);
      opt.textContent = `${escapeHtml(v.tag)} — ${formatDate(v.created_at)}`;
      select.appendChild(opt);
    }
  }

  async function loadVersionHistory() {
    if (!livePreviewId) return;
    const res = await fetch(`/api/previews/${livePreviewId}/versions`, {
      headers: { ...authHeader() },
    });
    const data = await res.json().catch(() => ({}));
    const tbody = document.getElementById("versionHistoryBody");
    const empty = document.getElementById("versionHistoryEmpty");
    const table = document.getElementById("versionHistoryTable");
    if (!tbody) return;

    tbody.innerHTML = "";
    const versions = data.versions || [];

    if (versions.length === 0) {
      if (empty) empty.hidden = false;
      if (table) table.hidden = true;
      return;
    }

    if (empty) empty.hidden = true;
    if (table) table.hidden = false;

    for (const v of versions) {
      const tr = document.createElement("tr");
      const tagCell = v.tag
        ? `<span class="version-tag-badge">${escapeHtml(v.tag)}</span>`
        : `<span style="opacity:0.4">—</span>`;
      const actions = [
        `<button class="button-link" data-action="restoreVersion" data-version-id="${v.id}">Restore</button>`,
        v.tag
          ? `<button class="button-link danger" data-action="removeVersionTag" data-version-id="${v.id}">Remove tag</button>`
          : `<button class="button-link" data-action="tagVersion" data-version-id="${v.id}">Tag…</button>`,
      ].join(" ");
      tr.innerHTML = `<td>${escapeHtml(formatDate(v.created_at))}</td><td>${tagCell}</td><td>${actions}</td>`;
      tbody.appendChild(tr);
    }
  }

  function switchTab(tab) {
    activeTab = tab;
    const editorContent = document.querySelector('[data-tab-content="editor"]');
    const historyContent = document.querySelector('[data-tab-content="history"]');
    const saveBtn = document.getElementById("liveEditSaveBtn");
    const unsaved = document.getElementById("liveEditUnsaved");

    document.querySelectorAll(".tab-btn[data-tab]").forEach((btn) => {
      btn.classList.toggle("is-active", btn.dataset.tab === tab);
    });

    if (tab === "editor") {
      if (editorContent) editorContent.hidden = false;
      if (historyContent) historyContent.hidden = true;
      if (saveBtn) saveBtn.hidden = false;
      updateLiveUnsaved();
      // Let Monaco re-measure after becoming visible
      requestAnimationFrame(() => liveEd?.layout());
    } else {
      if (editorContent) editorContent.hidden = true;
      if (historyContent) historyContent.hidden = false;
      if (saveBtn) saveBtn.hidden = true;
      if (unsaved) unsaved.hidden = true;
      loadVersionHistory();
    }
  }

  // Tab clicks
  document.addEventListener("click", (e) => {
    const target = e.target instanceof Element ? e.target : null;
    const btn = target?.closest(".tab-btn[data-tab]");
    if (!btn) return;
    const tab = btn.dataset.tab;
    if (tab) switchTab(tab);
  });

  // Go to history tab
  document.addEventListener("click", (e) => {
    const target = e.target instanceof Element ? e.target : null;
    if (!target?.closest('[data-action="goToHistory"]')) return;
    switchTab("history");
  });

  // Restore a version into editor
  document.addEventListener("click", async (e) => {
    const target = e.target instanceof Element ? e.target : null;
    const btn = target?.closest('[data-action="restoreVersion"]');
    if (!btn || !livePreviewId) return;
    const versionId = btn.getAttribute("data-version-id");
    if (!versionId) return;
    const res = await fetch(`/api/previews/${livePreviewId}/versions/${versionId}`, {
      headers: { ...authHeader() },
    });
    const data = await res.json().catch(() => ({}));
    if (!data.ok || !liveEd) return;
    liveEd.setValue(data.version.html_content);
    switchTab("editor");
    updateLiveUnsaved();
  });

  // Tag a version
  document.addEventListener("click", async (e) => {
    const target = e.target instanceof Element ? e.target : null;
    const btn = target?.closest('[data-action="tagVersion"]');
    if (!btn || !livePreviewId) return;
    const versionId = btn.getAttribute("data-version-id");
    if (!versionId) return;
    const tag = prompt("Tag name (e.g. v1, v2):");
    if (!tag?.trim()) return;
    const res = await fetch(`/api/previews/${livePreviewId}/versions/${versionId}/tag`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeader() },
      body: JSON.stringify({ tag: tag.trim() }),
    });
    const data = await res.json().catch(() => ({}));
    if (data.ok) {
      loadVersionHistory();
      loadTaggedVersions();
    }
  });

  // Remove tag from a version
  document.addEventListener("click", async (e) => {
    const target = e.target instanceof Element ? e.target : null;
    const btn = target?.closest('[data-action="removeVersionTag"]');
    if (!btn || !livePreviewId) return;
    const versionId = btn.getAttribute("data-version-id");
    if (!versionId) return;
    const res = await fetch(`/api/previews/${livePreviewId}/versions/${versionId}/tag`, {
      method: "DELETE",
      headers: { ...authHeader() },
    });
    const data = await res.json().catch(() => ({}));
    if (data.ok) {
      loadVersionHistory();
      loadTaggedVersions();
    }
  });

  // Tagged version dropdown: load selected version into editor
  document.addEventListener("change", async (e) => {
    const target = e.target instanceof Element ? e.target : null;
    if (!target || target.id !== "versionTagSelect") return;
    const versionId = target.value;
    if (!versionId || !liveEd || !livePreviewId) return;
    const res = await fetch(`/api/previews/${livePreviewId}/versions/${versionId}`, {
      headers: { ...authHeader() },
    });
    const data = await res.json().catch(() => ({}));
    if (!data.ok) return;
    liveEd.setValue(data.version.html_content);
    target.value = "";
    updateLiveUnsaved();
  });

  // Inject data-hap-line="N" onto every opening tag so the iframe can report source lines.
  // Works line-by-line, which handles the vast majority of hand-written HTML correctly.
  function injectSourceMarkers(html) {
    const lines = html.split("\n");
    return lines.map((line, idx) => {
      const lineNum = idx + 1;
      return line.replace(/<([a-zA-Z][a-zA-Z0-9-]*)([^>]*?)(\/?>)/g, (_, tag, attrs, end) => {
        return `<${tag}${attrs.trimEnd()} data-hap-line="${lineNum}"${end}`;
      });
    }).join("\n");
  }

  // Build the srcdoc value: source markers + a small interaction script injected before </body>.
  function buildSrcdoc(html) {
    const marked = injectSourceMarkers(html);
    const script = `<script>
(function() {
  var h = null;
  document.addEventListener("mouseover", function(e) {
    var el = e.target;
    if (el === document.documentElement || el === document.body) return;
    if (h && h !== el) { h.style.removeProperty("outline"); h.style.removeProperty("cursor"); }
    h = el;
    el.style.setProperty("outline", "2px solid rgba(66,153,225,0.7)", "important");
    el.style.setProperty("cursor", "crosshair", "important");
  }, true);
  document.addEventListener("mouseout", function(e) {
    e.target.style.removeProperty("outline");
    e.target.style.removeProperty("cursor");
  }, true);
  document.addEventListener("click", function(e) {
    var el = e.target;
    var isInteractive = !!el.closest("a, button, input, select, textarea, [onclick], [role=button]");
    if (isInteractive) e.preventDefault();
    while (el && !el.dataset.hapLine) el = el.parentElement;
    if (el && el.dataset.hapLine) {
      window.parent.postMessage({ type: "hap-click", line: +el.dataset.hapLine }, "*");
    }
  }, true);
})();
<` + `/script>`;
    const closeBody = marked.lastIndexOf("</body>");
    return closeBody !== -1
      ? marked.slice(0, closeBody) + script + "\n" + marked.slice(closeBody)
      : marked + "\n" + script;
  }

  // --- Open modal ---
  document.addEventListener("click", (e) => {
    const target = e.target instanceof Element ? e.target : null;
    const btn = target?.closest('[data-action="openLiveEdit"]');
    if (!btn) return;

    livePreviewId = btn.getAttribute("data-preview-id") || "";

    const html = document.getElementById("previewFrame")?.getAttribute("srcdoc") || "";

    const titleEl = document.querySelector("[data-live-edit-title]");
    const headingEl = document.querySelector("h1");
    if (titleEl && headingEl) titleEl.textContent = headingEl.textContent;

    openModal("liveEditModal");
    switchTab("editor");
    initLiveMonaco(html);
    loadTaggedVersions();
  });

  // --- Monaco init ---
  function initLiveMonaco(initialHtml) {
    const editorEl = document.getElementById("liveEditEditor");
    const frame = document.getElementById("liveEditFrame");
    if (!editorEl || !frame) return;

    frame.setAttribute("srcdoc", buildSrcdoc(initialHtml));
    liveLastSaved = initialHtml;

    if (liveEd) {
      liveEd.setValue(initialHtml);
      hapDecorations = liveEd.deltaDecorations(hapDecorations, []);
      updateLiveUnsaved();
      return;
    }

    const loaderReady = window.require
      ? Promise.resolve()
      : new Promise((resolve, reject) => {
          const s = document.createElement("script");
          s.src = "/static/vendor/monaco/loader.js";
          s.onload = resolve;
          s.onerror = reject;
          document.head.appendChild(s);
        });

    loaderReady.then(() => {
      const loader = window.require;
      if (!loader) return;

      loader.config({ paths: { vs: "/static/vendor/monaco/vs" } });
      loader(["vs/editor/editor.main"], function () {
        // eslint-disable-next-line no-undef
        liveEd = monaco.editor.create(editorEl, {
          value: initialHtml,
          language: "html",
          theme: "vs-dark",
          automaticLayout: true,
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
          fontSize: 13,
          minimap: { enabled: false },
          wordWrap: "on",
        });

        updateLiveUnsaved();

        // Replace document in-place — no iframe navigation, no flash, scroll preserved.
        function writeLiveFrame(html) {
          const doc = frame.contentDocument;
          const win = frame.contentWindow;
          if (doc && win) {
            const scrollY = win.scrollY;
            doc.open();
            doc.write(buildSrcdoc(html));
            doc.close();
            requestAnimationFrame(() => win.scrollTo(0, scrollY));
          } else {
            frame.setAttribute("srcdoc", buildSrcdoc(html));
          }
        }

        let raf = 0;
        liveEd.onDidChangeModelContent(() => {
          cancelAnimationFrame(raf);
          raf = requestAnimationFrame(() => {
            writeLiveFrame(liveEd.getValue());
            updateLiveUnsaved();
          });
        });

        // --- Click-to-source: receive line number from iframe, highlight in editor ---
        window.addEventListener("message", function (e) {
          const liveFrame = document.getElementById("liveEditFrame");
          if (e.source !== liveFrame?.contentWindow) return;
          if (e.data?.type !== "hap-click") return;
          const line = e.data.line;
          if (!liveEd || !line) return;
          // eslint-disable-next-line no-undef
          hapDecorations = liveEd.deltaDecorations(hapDecorations, [{
            range: new monaco.Range(line, 1, line, Number.MAX_VALUE),
            options: {
              isWholeLine: true,
              className: "hap-line-highlight",
              linesDecorationsClassName: "hap-line-gutter",
            },
          }]);
          liveEd.revealLineInCenter(line);
          liveEd.setPosition({ lineNumber: line, column: 1 });
        });
      });
    }).catch(() => {});
  }

  // --- Unsaved indicator ---
  function updateLiveUnsaved() {
    const el = document.getElementById("liveEditUnsaved");
    if (!el || !liveEd) return;
    el.hidden = liveEd.getValue() === liveLastSaved;
  }

  // --- Save ---
  document.addEventListener("click", async (e) => {
    const target = e.target instanceof Element ? e.target : null;
    const btn = target?.closest('[data-action="saveLiveEdit"]');
    if (!btn || !liveEd) return;

    const html = liveEd.getValue();
    const res = await fetch(`/api/previews/${livePreviewId}/html`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...authHeader() },
      body: JSON.stringify({ html }),
    });
    const data = await res.json().catch(() => ({}));
    if (!data.ok) return;

    liveLastSaved = html;
    updateLiveUnsaved();
    loadTaggedVersions();

    const viewFrame = document.getElementById("previewFrame");
    if (viewFrame) viewFrame.setAttribute("srcdoc", html);
  });
}());

document.addEventListener("DOMContentLoaded", () => {
  const viewFrame = document.querySelector("#previewFrame[data-auto-resize]");
  ensureIframeAutoResize(viewFrame);
  const notesBtn = document.querySelector('[data-notes-button]');
  if (notesBtn) {
    const count = Number(notesBtn.getAttribute('data-note-count') || '0');
    setNotesCount(count);
    const label = notesBtn.querySelector('[data-note-label]');
    if (label) label.textContent = 'See notes';
  }
});
