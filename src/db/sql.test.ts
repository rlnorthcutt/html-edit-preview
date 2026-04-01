import { assert, assertEquals, assertExists, assertNotEquals } from "jsr:@std/assert";
import { PreviewDB } from "./sql.ts";

function makeDb(): PreviewDB {
  return new PreviewDB(":memory:");
}

function futureExpiry(): string {
  return new Date(Date.now() + 3_600_000).toISOString();
}

// ---- Settings ----

Deno.test("settings: getSetting returns null for unknown key", () => {
  assertEquals(makeDb().getSetting("no-such-key"), null);
});

Deno.test("settings: setSetting and getSetting round-trip", () => {
  const db = makeDb();
  db.setSetting("k", "v");
  assertEquals(db.getSetting("k"), "v");
});

Deno.test("settings: setSetting overwrites existing value", () => {
  const db = makeDb();
  db.setSetting("k", "first");
  db.setSetting("k", "second");
  assertEquals(db.getSetting("k"), "second");
});

// ---- Sessions ----

Deno.test("sessions: createSession and getSession", () => {
  const db = makeDb();
  db.createSession("tok1", "alice", futureExpiry());
  const s = db.getSession("tok1");
  assertExists(s);
  assertEquals(s.name, "alice");
  assertEquals(s.token, "tok1");
});

Deno.test("sessions: getSession returns null for missing token", () => {
  assertEquals(makeDb().getSession("none"), null);
});

Deno.test("sessions: deleteSession removes it", () => {
  const db = makeDb();
  db.createSession("tok2", "bob", futureExpiry());
  db.deleteSession("tok2");
  assertEquals(db.getSession("tok2"), null);
});

Deno.test("sessions: cleanupExpiredSessions removes only expired rows", () => {
  const db = makeDb();
  db.createSession("exp", "gone", new Date(Date.now() - 1_000).toISOString());
  db.createSession("live", "here", futureExpiry());
  db.cleanupExpiredSessions();
  assertEquals(db.getSession("exp"), null);
  assertExists(db.getSession("live"));
});

Deno.test("sessions: clearAllSessions removes every session", () => {
  const db = makeDb();
  db.createSession("t1", "u1", futureExpiry());
  db.createSession("t2", "u2", futureExpiry());
  db.clearAllSessions();
  assertEquals(db.getSession("t1"), null);
  assertEquals(db.getSession("t2"), null);
});

// ---- Previews ----

Deno.test("previews: createPreview returns a positive numeric id", () => {
  const db = makeDb();
  const id = db.createPreview({ title: "T", description: "", status: "Draft", type: "Mockup", owner: "me" });
  assert(Number.isFinite(id) && id > 0);
});

Deno.test("previews: getPreview returns the created preview", () => {
  const db = makeDb();
  const id = db.createPreview({ title: "My P", description: "Desc", status: "Draft", type: "Email", owner: "bob" });
  const p = db.getPreview(id);
  assertExists(p);
  assertEquals(p.title, "My P");
  assertEquals(p.description, "Desc");
  assertEquals(p.type, "Email");
  assertEquals(p.owner, "bob");
});

Deno.test("previews: getPreview returns null for unknown id", () => {
  assertEquals(makeDb().getPreview(99_999), null);
});

Deno.test("previews: listPreviews returns all previews", () => {
  const db = makeDb();
  db.createPreview({ title: "P1", description: "", status: "Draft", type: "Mockup", owner: "" });
  db.createPreview({ title: "P2", description: "", status: "Approved", type: "Email", owner: "" });
  // Seed preview from init + 2 created
  assert(db.listPreviews({}).length >= 3);
});

Deno.test("previews: listPreviews filters by status", () => {
  const db = makeDb();
  db.createPreview({ title: "D", description: "", status: "Draft", type: "Mockup", owner: "" });
  db.createPreview({ title: "A", description: "", status: "Approved", type: "Mockup", owner: "" });
  const drafts = db.listPreviews({ status: "Draft" });
  assert(drafts.length >= 1);
  assert(drafts.every((p) => p.status === "Draft"));
});

Deno.test("previews: listPreviews with status 'All' returns every preview", () => {
  const db = makeDb();
  db.createPreview({ title: "D", description: "", status: "Draft", type: "Mockup", owner: "" });
  db.createPreview({ title: "A", description: "", status: "Approved", type: "Mockup", owner: "" });
  assertEquals(db.listPreviews({ status: "All" }).length, db.listPreviews({}).length);
});

Deno.test("previews: updatePreviewMeta changes fields", () => {
  const db = makeDb();
  const id = db.createPreview({ title: "Old", description: "", status: "Draft", type: "Mockup", owner: "" });
  db.updatePreviewMeta(id, { title: "New", description: "D", status: "Approved", type: "Email", owner: "x" });
  const p = db.getPreview(id);
  assertEquals(p?.title, "New");
  assertEquals(p?.status, "Approved");
  assertEquals(p?.type, "Email");
  assertEquals(p?.owner, "x");
});

Deno.test("previews: updatePreviewHtml replaces html_content", () => {
  const db = makeDb();
  const id = db.createPreview({ title: "T", description: "", status: "Draft", type: "Mockup", owner: "" });
  db.updatePreviewHtml(id, "<p>hello</p>");
  assertEquals(db.getPreview(id)?.html_content, "<p>hello</p>");
});

Deno.test("previews: deletePreview removes the row", () => {
  const db = makeDb();
  const id = db.createPreview({ title: "Gone", description: "", status: "Draft", type: "Mockup", owner: "" });
  db.deletePreview(id);
  assertEquals(db.getPreview(id), null);
});

// ---- Notes ----

Deno.test("notes: addNote and listNotes", () => {
  const db = makeDb();
  const pid = db.createPreview({ title: "T", description: "", status: "Draft", type: "Mockup", owner: "" });
  db.addNote(pid, "alice", "Great!");
  const notes = db.listNotes(pid);
  assertEquals(notes.length, 1);
  assertEquals(notes[0].author_name, "alice");
  assertEquals(notes[0].comment, "Great!");
});

Deno.test("notes: countNotes returns correct count", () => {
  const db = makeDb();
  const pid = db.createPreview({ title: "T", description: "", status: "Draft", type: "Mockup", owner: "" });
  db.addNote(pid, "a", "one");
  db.addNote(pid, "b", "two");
  assertEquals(db.countNotes(pid), 2);
});

Deno.test("notes: countNotes returns 0 for no notes", () => {
  const db = makeDb();
  const pid = db.createPreview({ title: "T", description: "", status: "Draft", type: "Mockup", owner: "" });
  assertEquals(db.countNotes(pid), 0);
});

Deno.test("notes: updateNote changes author and comment", () => {
  const db = makeDb();
  const pid = db.createPreview({ title: "T", description: "", status: "Draft", type: "Mockup", owner: "" });
  db.addNote(pid, "alice", "original");
  const noteId = db.listNotes(pid)[0].id;
  db.updateNote(noteId, "bob", "updated");
  const note = db.listNotes(pid)[0];
  assertEquals(note.author_name, "bob");
  assertEquals(note.comment, "updated");
});

Deno.test("notes: deleteNote removes the row", () => {
  const db = makeDb();
  const pid = db.createPreview({ title: "T", description: "", status: "Draft", type: "Mockup", owner: "" });
  db.addNote(pid, "alice", "bye");
  const noteId = db.listNotes(pid)[0].id;
  db.deleteNote(noteId);
  assertEquals(db.listNotes(pid).length, 0);
});

Deno.test("notes: cascade delete removes notes when preview is deleted", () => {
  const db = makeDb();
  const pid = db.createPreview({ title: "T", description: "", status: "Draft", type: "Mockup", owner: "" });
  db.addNote(pid, "a", "will vanish");
  db.deletePreview(pid);
  assertEquals(db.listNotes(pid).length, 0);
});

// ---- Versions ----

Deno.test("versions: saveVersion stores a version", () => {
  const db = makeDb();
  const pid = db.createPreview({ title: "T", description: "", status: "Draft", type: "Mockup", owner: "" });
  db.saveVersion(pid, "<p>v1</p>");
  const versions = db.listVersions(pid);
  assertEquals(versions.length, 1);
  assertEquals(versions[0].html_content, "<p>v1</p>");
  assertEquals(versions[0].tag, null);
});

Deno.test("versions: listVersions is ordered newest first", () => {
  const db = makeDb();
  const pid = db.createPreview({ title: "T", description: "", status: "Draft", type: "Mockup", owner: "" });
  db.saveVersion(pid, "<p>first</p>");
  db.saveVersion(pid, "<p>second</p>");
  const versions = db.listVersions(pid);
  assertEquals(versions[0].html_content, "<p>second</p>");
  assertEquals(versions[1].html_content, "<p>first</p>");
});

Deno.test("versions: saveVersion prunes untagged versions beyond 5", () => {
  const db = makeDb();
  const pid = db.createPreview({ title: "T", description: "", status: "Draft", type: "Mockup", owner: "" });
  for (let i = 1; i <= 7; i++) {
    db.saveVersion(pid, `<p>v${i}</p>`);
  }
  const untagged = db.listVersions(pid).filter((v) => !v.tag);
  assertEquals(untagged.length, 5);
  // Most recent 5 are kept
  assertEquals(untagged[0].html_content, "<p>v7</p>");
  assertEquals(untagged[4].html_content, "<p>v3</p>");
});

Deno.test("versions: tagged versions survive pruning", () => {
  const db = makeDb();
  const pid = db.createPreview({ title: "T", description: "", status: "Draft", type: "Mockup", owner: "" });

  db.saveVersion(pid, "<p>tagged-a</p>");
  const v1Id = db.listVersions(pid)[0].id;
  db.tagVersion(v1Id, "v1");

  // Fill up + overflow untagged pool
  for (let i = 0; i < 7; i++) db.saveVersion(pid, `<p>untagged-${i}</p>`);

  const all = db.listVersions(pid);
  const tagged = all.filter((v) => v.tag);
  assertEquals(tagged.length, 1);
  assertEquals(tagged[0].tag, "v1");
  assertEquals(tagged[0].html_content, "<p>tagged-a</p>");
});

Deno.test("versions: multiple tagged versions all survive", () => {
  const db = makeDb();
  const pid = db.createPreview({ title: "T", description: "", status: "Draft", type: "Mockup", owner: "" });

  for (const label of ["v1", "v2", "v3"]) {
    db.saveVersion(pid, `<p>${label}</p>`);
    const vId = db.listVersions(pid)[0].id;
    db.tagVersion(vId, label);
  }
  for (let i = 0; i < 7; i++) db.saveVersion(pid, `<p>u${i}</p>`);

  const tagged = db.listVersions(pid).filter((v) => v.tag);
  assertEquals(tagged.length, 3);
  assertEquals(tagged.map((v) => v.tag).sort(), ["v1", "v2", "v3"]);
});

Deno.test("versions: listTaggedVersions returns only tagged, without html_content", () => {
  const db = makeDb();
  const pid = db.createPreview({ title: "T", description: "", status: "Draft", type: "Mockup", owner: "" });
  db.saveVersion(pid, "<p>tagged</p>");
  const vId = db.listVersions(pid)[0].id;
  db.tagVersion(vId, "release");
  db.saveVersion(pid, "<p>untagged</p>");

  const tagged = db.listTaggedVersions(pid);
  assertEquals(tagged.length, 1);
  assertEquals(tagged[0].tag, "release");
  // html_content should not be present in the lightweight listing
  assertEquals("html_content" in tagged[0], false);
});

Deno.test("versions: getVersion returns full html_content", () => {
  const db = makeDb();
  const pid = db.createPreview({ title: "T", description: "", status: "Draft", type: "Mockup", owner: "" });
  db.saveVersion(pid, "<p>specific</p>");
  const vId = db.listVersions(pid)[0].id;
  const v = db.getVersion(vId);
  assertExists(v);
  assertEquals(v.html_content, "<p>specific</p>");
});

Deno.test("versions: getVersion returns null for unknown id", () => {
  assertEquals(makeDb().getVersion(99_999), null);
});

Deno.test("versions: tagVersion sets the tag field", () => {
  const db = makeDb();
  const pid = db.createPreview({ title: "T", description: "", status: "Draft", type: "Mockup", owner: "" });
  db.saveVersion(pid, "<p>x</p>");
  const vId = db.listVersions(pid)[0].id;
  db.tagVersion(vId, "stable");
  assertEquals(db.getVersion(vId)?.tag, "stable");
});

Deno.test("versions: removeVersionTag clears the tag to null", () => {
  const db = makeDb();
  const pid = db.createPreview({ title: "T", description: "", status: "Draft", type: "Mockup", owner: "" });
  db.saveVersion(pid, "<p>x</p>");
  const vId = db.listVersions(pid)[0].id;
  db.tagVersion(vId, "temp");
  db.removeVersionTag(vId);
  assertEquals(db.getVersion(vId)?.tag, null);
});

Deno.test("versions: removing tag allows it to be pruned later", () => {
  const db = makeDb();
  const pid = db.createPreview({ title: "T", description: "", status: "Draft", type: "Mockup", owner: "" });
  db.saveVersion(pid, "<p>to-untag</p>");
  const vId = db.listVersions(pid)[0].id;
  db.tagVersion(vId, "temp");
  db.removeVersionTag(vId);
  // Now add 5 newer untagged versions — the untagged one should be pruned
  for (let i = 0; i < 5; i++) db.saveVersion(pid, `<p>new-${i}</p>`);
  db.saveVersion(pid, "<p>trigger-prune</p>");
  const all = db.listVersions(pid).filter((v) => !v.tag);
  assertEquals(all.every((v) => v.html_content !== "<p>to-untag</p>"), true);
});

Deno.test("versions: cascade delete removes versions when preview is deleted", () => {
  const db = makeDb();
  const pid = db.createPreview({ title: "T", description: "", status: "Draft", type: "Mockup", owner: "" });
  db.saveVersion(pid, "<p>v</p>");
  db.deletePreview(pid);
  assertEquals(db.listVersions(pid).length, 0);
});

// ---- Stats ----

Deno.test("getStats returns non-negative counts for all fields", () => {
  const db = makeDb();
  const stats = db.getStats();
  assert(stats.previews >= 0);
  assert(stats.notes >= 0);
  assert(stats.sessions >= 0);
});

Deno.test("getStats reflects added data", () => {
  const db = makeDb();
  const before = db.getStats();
  db.createPreview({ title: "T", description: "", status: "Draft", type: "Mockup", owner: "" });
  assertEquals(db.getStats().previews, before.previews + 1);
});
