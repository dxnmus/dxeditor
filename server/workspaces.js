import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { createWatcher } from "./watcher.js";
import { createLinkIndex } from "./links.js";

/**
 * Workspace registry: named root folders the app can open (personal drafts,
 * shared OneDrive school folders, …). Stored in <project>/workspaces.json.
 * Each workspace lazily gets its own file watcher and link index.
 */
export function createWorkspaceManager({ registryPath, seedRoot, onEvent }) {
  let registry = load();
  const runtimes = new Map(); // id -> { watcher, links }

  function load() {
    try {
      const raw = JSON.parse(fs.readFileSync(registryPath, "utf8"));
      if (Array.isArray(raw.workspaces)) return raw.workspaces;
    } catch {
      /* missing or malformed -> seed below */
    }
    // First boot: seed from the legacy single ROOT_DIR so v2 setups keep working.
    const seed = [
      {
        id: newId(),
        name: path.basename(seedRoot),
        root: path.resolve(seedRoot),
      },
    ];
    persist(seed);
    return seed;
  }

  function persist(list) {
    fs.writeFileSync(
      registryPath,
      JSON.stringify({ workspaces: list }, null, 2) + "\n",
      "utf8"
    );
  }

  function newId() {
    return crypto.randomBytes(4).toString("hex");
  }

  function badRequest(msg) {
    return Object.assign(new Error(msg), { status: 400 });
  }

  /** Validate a root path a user wants to add. */
  async function validateRoot(root) {
    const abs = path.resolve(root);
    let stat;
    try {
      stat = await fsp.stat(abs);
    } catch {
      throw badRequest(`Folder does not exist: ${abs}`);
    }
    if (!stat.isDirectory()) throw badRequest(`Not a folder: ${abs}`);
    return abs;
  }

  function get(id) {
    const ws = registry.find((w) => w.id === id);
    if (!ws) throw Object.assign(new Error("Unknown workspace"), { status: 404 });
    return ws;
  }

  /** Root dir for a workspace id (the default one if id is empty). */
  function rootOf(id) {
    if (!id) return registry[0].root;
    return get(id).root;
  }

  /** Lazily start the watcher + link index for a workspace. */
  function runtime(id) {
    const ws = id ? get(id) : registry[0];
    let rt = runtimes.get(ws.id);
    if (!rt) {
      const watcher = createWatcher(ws.root);
      const links = createLinkIndex(ws.root);
      watcher.subscribe((event) => {
        links.invalidate();
        onEvent({ ...event, ws: ws.id });
      });
      rt = { watcher, links };
      runtimes.set(ws.id, rt);
    }
    return rt;
  }

  return {
    list: () => registry,
    rootOf,
    links: (id) => runtime(id).links,
    markSelfWrite: (id, relPath) => runtime(id).watcher.markSelfWrite(relPath),
    /** Ensure the watcher is running (call when a client selects a workspace). */
    ensureWatching: (id) => void runtime(id),

    async add(name, root) {
      const abs = await validateRoot(root);
      if (registry.some((w) => path.resolve(w.root) === abs)) {
        throw badRequest("That folder is already a workspace");
      }
      const ws = {
        id: newId(),
        name: (name || path.basename(abs)).trim(),
        root: abs,
      };
      registry = [...registry, ws];
      persist(registry);
      return ws;
    },

    rename(id, name) {
      const ws = get(id);
      ws.name = String(name).trim() || ws.name;
      persist(registry);
      return ws;
    },

    /** Remove from the registry only — never touches the folder itself. */
    remove(id) {
      get(id); // throws if unknown
      if (registry.length === 1) {
        throw badRequest("Cannot remove the last workspace");
      }
      const rt = runtimes.get(id);
      if (rt) {
        rt.watcher.close();
        runtimes.delete(id);
      }
      registry = registry.filter((w) => w.id !== id);
      persist(registry);
    },
  };
}
