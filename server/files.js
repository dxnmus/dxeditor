import fs from "node:fs/promises";
import path from "node:path";

// Extensions we allow to be opened and written. Everything else is read-only
// in the tree (or hidden) so the tool stays a Markdown editor, not a file manager
// that can clobber binaries.
const EDITABLE_EXT = new Set([".md", ".markdown", ".mdown", ".txt"]);

// Folders we never descend into.
const IGNORED_DIRS = new Set([".git", "node_modules", ".obsidian", ".trash"]);

/**
 * Resolve a client-supplied relative path against the root and guarantee the
 * result stays inside the root. Throws on any traversal attempt.
 */
export function safeResolve(rootDir, relPath) {
  const cleaned = (relPath || "").replace(/^[/\\]+/, "");
  const abs = path.resolve(rootDir, cleaned);
  const rootResolved = path.resolve(rootDir);
  if (abs !== rootResolved && !abs.startsWith(rootResolved + path.sep)) {
    throw Object.assign(new Error("Path escapes root directory"), { status: 400 });
  }
  return abs;
}

export function isEditable(filePath) {
  return EDITABLE_EXT.has(path.extname(filePath).toLowerCase());
}

/** A comments sidecar (post.comments.json) — internal, never shown in the tree. */
function isSidecar(name) {
  return /\.comments\.json$/i.test(name);
}

/**
 * Build a recursive tree of folders and editable files, sorted folders-first
 * then alphabetically. Returns nodes shaped for the frontend file tree.
 */
export async function listTree(rootDir, relDir = "") {
  const absDir = safeResolve(rootDir, relDir);
  let entries;
  try {
    entries = await fs.readdir(absDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const nodes = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue; // hidden files and folders
    if (IGNORED_DIRS.has(entry.name)) continue;
    if (isSidecar(entry.name)) continue; // comments sidecars are internal

    const relPath = path.posix.join(relDir.split(path.sep).join("/"), entry.name);

    if (entry.isDirectory()) {
      const children = await listTree(rootDir, path.join(relDir, entry.name));
      nodes.push({ type: "dir", name: entry.name, path: relPath, children });
    } else {
      // Non-markdown files show read-only so the folder structure stays faithful
      // to what's on disk (Claude Code pipelines drop assets alongside drafts).
      nodes.push({
        type: "file",
        name: entry.name,
        path: relPath,
        editable: isEditable(entry.name),
      });
    }
  }

  nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });

  // Keep empty folders: the tree should mirror the real directory structure so
  // newly created folders appear and you can build a hierarchy before adding notes.
  return nodes;
}

/**
 * Split a leading YAML frontmatter block from a document.
 * Returns { frontmatter: string|null, body }. The frontmatter string is the
 * raw YAML between the --- fences (fences not included).
 */
export function splitFrontmatter(content) {
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { frontmatter: null, body: content };
  return { frontmatter: m[1], body: content.slice(m[0].length) };
}

export async function readFile(rootDir, relPath) {
  const abs = safeResolve(rootDir, relPath);
  if (!isEditable(abs)) {
    throw Object.assign(new Error("File type not supported"), { status: 400 });
  }
  const [content, stat] = await Promise.all([
    fs.readFile(abs, "utf8"),
    fs.stat(abs),
  ]);
  const { frontmatter, body } = splitFrontmatter(content);
  return { content, frontmatter, body, mtimeMs: stat.mtimeMs };
}

/**
 * Write a file. If `baseMtimeMs` is provided and the file on disk is newer,
 * refuse the write (conflict) so a teammate's save via OneDrive isn't clobbered.
 * Returns { conflict: true, ... } on conflict, else { mtimeMs }.
 */
export async function writeFile(rootDir, relPath, content, baseMtimeMs) {
  const abs = safeResolve(rootDir, relPath);
  if (!isEditable(abs)) {
    throw Object.assign(new Error("File type not supported"), { status: 400 });
  }

  if (baseMtimeMs != null) {
    try {
      const stat = await fs.stat(abs);
      // Allow a 1s fuzz for filesystem timestamp granularity.
      if (stat.mtimeMs - baseMtimeMs > 1000) {
        const disk = await fs.readFile(abs, "utf8");
        return { conflict: true, diskContent: disk, mtimeMs: stat.mtimeMs };
      }
    } catch {
      // File no longer exists; treat as a fresh create.
    }
  }

  await fs.writeFile(abs, content, "utf8");
  const stat = await fs.stat(abs);
  return { conflict: false, mtimeMs: stat.mtimeMs };
}

export async function createFile(rootDir, relPath) {
  const abs = safeResolve(rootDir, relPath);
  if (!isEditable(abs)) {
    throw Object.assign(new Error("New files must be .md, .markdown or .txt"), {
      status: 400,
    });
  }
  try {
    await fs.access(abs);
    throw Object.assign(new Error("A file with that name already exists"), {
      status: 409,
    });
  } catch (err) {
    if (err.status) throw err; // our own "already exists"
  }
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, "", { flag: "wx" });
  const stat = await fs.stat(abs);
  return { mtimeMs: stat.mtimeMs };
}

export async function createFolder(rootDir, relPath) {
  const abs = safeResolve(rootDir, relPath);
  await fs.mkdir(abs, { recursive: true });
}

/** Sidecar comments file for a note path, e.g. post.md -> post.comments.json */
function sidecarOf(relPath) {
  return relPath.replace(/\.(md|markdown|mdown|txt)$/i, "") + ".comments.json";
}

export async function rename(rootDir, fromRel, toRel) {
  const fromAbs = safeResolve(rootDir, fromRel);
  const toAbs = safeResolve(rootDir, toRel);
  try {
    await fs.access(toAbs);
    throw Object.assign(new Error("Target name already exists"), { status: 409 });
  } catch (err) {
    if (err.status) throw err;
  }
  await fs.mkdir(path.dirname(toAbs), { recursive: true });
  await fs.rename(fromAbs, toAbs);

  // Keep a note's comments sidecar with it.
  if (isEditable(fromRel)) {
    const fromSidecar = safeResolve(rootDir, sidecarOf(fromRel));
    const toSidecar = safeResolve(rootDir, sidecarOf(toRel));
    try {
      await fs.rename(fromSidecar, toSidecar);
    } catch {
      /* no sidecar — fine */
    }
  }
}

export async function remove(rootDir, relPath) {
  const abs = safeResolve(rootDir, relPath);
  const rootResolved = path.resolve(rootDir);
  if (abs === rootResolved) {
    throw Object.assign(new Error("Refusing to delete the root folder"), {
      status: 400,
    });
  }
  await fs.rm(abs, { recursive: true, force: false });

  // A deleted note takes its comments sidecar with it.
  if (isEditable(relPath)) {
    await fs.rm(safeResolve(rootDir, sidecarOf(relPath)), { force: true });
  }
}

/**
 * Full-text search across editable files. Returns files with a matching name
 * or content, including the first matching line for context.
 */
export async function search(rootDir, query) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const results = [];

  async function walk(relDir) {
    const absDir = safeResolve(rootDir, relDir);
    let entries;
    try {
      entries = await fs.readdir(absDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      if (entry.name.startsWith(".") && entry.isDirectory()) continue;
      const relPath = path.posix.join(
        relDir.split(path.sep).join("/"),
        entry.name
      );
      if (entry.isDirectory()) {
        await walk(path.join(relDir, entry.name));
      } else if (isEditable(entry.name)) {
        const nameMatch = entry.name.toLowerCase().includes(q);
        let snippet = null;
        try {
          const text = await fs.readFile(safeResolve(rootDir, relPath), "utf8");
          const line = text
            .split(/\r?\n/)
            .find((l) => l.toLowerCase().includes(q));
          if (line) snippet = line.trim().slice(0, 200);
        } catch {
          /* ignore unreadable files */
        }
        if (nameMatch || snippet) {
          results.push({ path: relPath, name: entry.name, snippet });
        }
      }
    }
  }

  await walk("");
  return results.slice(0, 100);
}
