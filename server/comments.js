import fs from "node:fs/promises";
import crypto from "node:crypto";
import { safeResolve, isEditable } from "./files.js";

/**
 * Comments live in a sidecar file next to each note:
 *   post.md -> post.comments.json
 * The note itself stays clean for publishing; the sidecar syncs through
 * OneDrive with the note and is trivially readable by Claude Code agents
 * in the content pipeline (see the AGENTS.md convention).
 */

/** Sidecar path for a note path (relative paths in, relative path out). */
export function sidecarFor(relPath) {
  return relPath.replace(/\.(md|markdown|mdown|txt)$/i, "") + ".comments.json";
}

/** Is this path a comments sidecar? Returns the note base or null. */
export function isSidecar(relPath) {
  return /\.comments\.json$/i.test(relPath);
}

function assertNote(relPath) {
  if (!isEditable(relPath)) {
    throw Object.assign(new Error("Not a note path"), { status: 400 });
  }
}

async function readSidecar(rootDir, relPath) {
  assertNote(relPath);
  const abs = safeResolve(rootDir, sidecarFor(relPath));
  try {
    const doc = JSON.parse(await fs.readFile(abs, "utf8"));
    return Array.isArray(doc.comments) ? doc.comments : [];
  } catch {
    return [];
  }
}

async function writeSidecar(rootDir, relPath, comments) {
  const abs = safeResolve(rootDir, sidecarFor(relPath));
  if (comments.length === 0) {
    // Last comment removed -> no sidecar clutter left behind.
    await fs.rm(abs, { force: true });
    return;
  }
  await fs.writeFile(
    abs,
    JSON.stringify({ version: 1, comments }, null, 2) + "\n",
    "utf8"
  );
}

export async function listComments(rootDir, relPath) {
  return readSidecar(rootDir, relPath);
}

export async function addComment(rootDir, relPath, { author, audience, text, anchor }) {
  if (!text || !String(text).trim()) {
    throw Object.assign(new Error("Comment text required"), { status: 400 });
  }
  const comments = await readSidecar(rootDir, relPath);
  const comment = {
    id: `c-${Date.now()}-${crypto.randomBytes(2).toString("hex")}`,
    author: String(author || "Anonymous").slice(0, 80),
    for: audience === "agent" ? "agent" : "team",
    status: "open",
    createdAt: new Date().toISOString(),
    anchor: anchor
      ? {
          quote: String(anchor.quote || "").slice(0, 1000),
          prefix: String(anchor.prefix || "").slice(0, 64),
          suffix: String(anchor.suffix || "").slice(0, 64),
        }
      : null,
    text: String(text).trim(),
    replies: [],
  };
  comments.push(comment);
  await writeSidecar(rootDir, relPath, comments);
  return comment;
}

export async function updateComment(rootDir, relPath, id, patch) {
  const comments = await readSidecar(rootDir, relPath);
  const comment = comments.find((c) => c.id === id);
  if (!comment) {
    throw Object.assign(new Error("Comment not found"), { status: 404 });
  }
  if (patch.status === "open" || patch.status === "resolved") {
    comment.status = patch.status;
  }
  if (typeof patch.text === "string" && patch.text.trim()) {
    comment.text = patch.text.trim();
  }
  if (patch.reply && String(patch.reply.text || "").trim()) {
    comment.replies = comment.replies || [];
    comment.replies.push({
      author: String(patch.reply.author || "Anonymous").slice(0, 80),
      text: String(patch.reply.text).trim(),
      createdAt: new Date().toISOString(),
    });
  }
  await writeSidecar(rootDir, relPath, comments);
  return comment;
}

export async function deleteComment(rootDir, relPath, id) {
  const comments = await readSidecar(rootDir, relPath);
  const next = comments.filter((c) => c.id !== id);
  if (next.length === comments.length) {
    throw Object.assign(new Error("Comment not found"), { status: 404 });
  }
  await writeSidecar(rootDir, relPath, next);
}
