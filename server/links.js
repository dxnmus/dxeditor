import fs from "node:fs/promises";
import path from "node:path";
import { listTree, safeResolve, isEditable } from "./files.js";

/**
 * Link index for wiki links and relative markdown links between notes.
 * Rebuilt lazily: watcher events mark it dirty; the next query rebuilds.
 *
 * Recognized link forms in note bodies:
 *   [[Note Name]] / [[Note Name|label]]  — matched to a note by basename
 *   [label](relative/path.md)            — resolved relative to the source file
 */
export function createLinkIndex(rootDir) {
  let dirty = true;
  let notes = []; // [{ path, name }]
  let backlinkMap = new Map(); // targetPath -> [{ path, name, snippet }]

  function flatten(nodes, out = []) {
    for (const n of nodes) {
      if (n.type === "file") out.push({ path: n.path, name: n.name });
      else flatten(n.children, out);
    }
    return out;
  }

  function baseName(p) {
    return path.posix.basename(p).replace(/\.(md|markdown|mdown|txt)$/i, "");
  }

  async function rebuild() {
    const tree = await listTree(rootDir);
    notes = flatten(tree);
    backlinkMap = new Map();

    // basename (lowercased) -> note path, for resolving [[Wiki Links]]
    const byBase = new Map();
    for (const n of notes) byBase.set(baseName(n.path).toLowerCase(), n.path);

    for (const note of notes) {
      let text;
      try {
        text = await fs.readFile(safeResolve(rootDir, note.path), "utf8");
      } catch {
        continue;
      }

      const targets = new Map(); // targetPath -> snippet line

      for (const line of text.split(/\r?\n/)) {
        // [[Name]] or [[Name|label]]
        for (const m of line.matchAll(/\[\[([^\]|#]+)(?:[^\]]*)?\]\]/g)) {
          const target = byBase.get(m[1].trim().toLowerCase());
          if (target && target !== note.path && !targets.has(target)) {
            targets.set(target, line.trim().slice(0, 200));
          }
        }
        // [label](relative.md)
        for (const m of line.matchAll(/\[[^\]]*\]\(([^)\s#]+\.(?:md|markdown|txt))\)/gi)) {
          let target;
          try {
            const raw = decodeURI(m[1]);
            if (raw.startsWith("/")) continue; // not a relative note link
            target = path.posix.normalize(
              path.posix.join(path.posix.dirname(note.path), raw)
            );
          } catch {
            continue;
          }
          if (target.startsWith("..")) continue;
          let exists = notes.some((n) => n.path === target);
          if (!exists) {
            // Tolerate root-relative links (e.g. hand-written "welcome.md"
            // inside a subfolder note).
            const rootRel = path.posix.normalize(m[1]);
            if (notes.some((n) => n.path === rootRel)) {
              target = rootRel;
              exists = true;
            }
          }
          if (exists && target !== note.path && !targets.has(target)) {
            targets.set(target, line.trim().slice(0, 200));
          }
        }
      }

      for (const [target, snippet] of targets) {
        if (!backlinkMap.has(target)) backlinkMap.set(target, []);
        backlinkMap.get(target).push({
          path: note.path,
          name: note.name,
          snippet,
        });
      }
    }
    dirty = false;
  }

  return {
    invalidate() {
      dirty = true;
    },
    async getNotes() {
      if (dirty) await rebuild();
      return notes;
    },
    async getBacklinks(relPath) {
      if (dirty) await rebuild();
      return backlinkMap.get(relPath) || [];
    },
  };
}
