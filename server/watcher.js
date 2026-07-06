import { watch } from "chokidar";
import path from "node:path";

/**
 * Watch the root folder and notify subscribers of external changes
 * (e.g. OneDrive syncing a teammate's edit). Writes made through this app's
 * own API are marked via markSelfWrite() and suppressed, so clients don't
 * get echo events for their own saves.
 *
 * Events are batched over a short window because sync clients often fire
 * bursts (temp file, rename, change) for a single logical update.
 */
export function createWatcher(rootDir) {
  const subscribers = new Set();
  const selfWrites = new Map(); // relPath -> timestamp
  const SELF_WINDOW_MS = 2500;

  let pending = []; // batched events
  let flushTimer = null;

  function toRel(absPath) {
    return path.relative(rootDir, absPath).split(path.sep).join("/");
  }

  function isSelf(relPath) {
    const ts = selfWrites.get(relPath);
    return ts != null && Date.now() - ts < SELF_WINDOW_MS;
  }

  function queue(event) {
    pending.push(event);
    if (!flushTimer) {
      flushTimer = setTimeout(flush, 300);
    }
  }

  function flush() {
    flushTimer = null;
    const events = pending;
    pending = [];

    // Comments sidecars (*.comments.json) get their own event type and never
    // affect the file tree — they're data for the comments panel.
    const isSidecar = (p) => /\.comments\.json$/i.test(p);
    const sidecarEvents = events.filter((e) => isSidecar(e.path));
    const noteEvents = events.filter((e) => !isSidecar(e.path));

    const treeChanged = noteEvents.some((e) => e.kind !== "change");
    const changedFiles = [
      ...new Set(
        noteEvents.filter((e) => e.kind === "change").map((e) => e.path)
      ),
    ];
    const changedSidecars = [...new Set(sidecarEvents.map((e) => e.path))];

    const out = [];
    if (treeChanged) out.push({ type: "tree" });
    for (const p of changedFiles) out.push({ type: "file", path: p });
    for (const p of changedSidecars) out.push({ type: "comments", path: p });
    if (out.length === 0) return;

    for (const fn of subscribers) {
      for (const ev of out) fn(ev);
    }
  }

  const watcher = watch(rootDir, {
    ignoreInitial: true,
    persistent: true,
    ignored: (p) => path.basename(p).startsWith("."),
    awaitWriteFinish: { stabilityThreshold: 400, pollInterval: 100 },
  });

  watcher
    .on("add", (p) => {
      const rel = toRel(p);
      if (!isSelf(rel)) queue({ kind: "add", path: rel });
    })
    .on("change", (p) => {
      const rel = toRel(p);
      if (!isSelf(rel)) queue({ kind: "change", path: rel });
    })
    .on("unlink", (p) => {
      const rel = toRel(p);
      if (!isSelf(rel)) queue({ kind: "unlink", path: rel });
    })
    .on("addDir", (p) => {
      const rel = toRel(p);
      if (rel && !isSelf(rel)) queue({ kind: "addDir", path: rel });
    })
    .on("unlinkDir", (p) => {
      const rel = toRel(p);
      if (rel && !isSelf(rel)) queue({ kind: "unlinkDir", path: rel });
    })
    .on("error", (err) => console.error("[watcher]", err.message));

  return {
    subscribe(fn) {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },
    /** Call right before/after a write made through the API. */
    markSelfWrite(relPath) {
      selfWrites.set(relPath, Date.now());
      // Opportunistic cleanup so the map doesn't grow forever.
      if (selfWrites.size > 500) {
        const cutoff = Date.now() - SELF_WINDOW_MS;
        for (const [k, v] of selfWrites) if (v < cutoff) selfWrites.delete(k);
      }
    },
    close: () => watcher.close(),
  };
}
