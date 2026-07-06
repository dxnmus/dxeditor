import express from "express";
import path from "node:path";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import { fileURLToPath } from "node:url";
import {
  listTree,
  readFile,
  writeFile,
  createFile,
  createFolder,
  rename,
  remove,
  search,
  safeResolve,
} from "./files.js";
import { createWorkspaceManager } from "./workspaces.js";
import {
  listComments,
  addComment,
  updateComment,
  deleteComment,
  sidecarFor,
} from "./comments.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Build the DXEditor server. Importable so the Electron app can embed it.
 *
 * @param {object} opts
 * @param {string} opts.dataDir  Where workspaces.json lives (must be writable).
 * @param {string} opts.seedRoot Folder used to seed workspaces.json on first boot.
 * @param {string} [opts.distDir] Built frontend to serve statically (production).
 * @returns {{ app: import("express").Express, listen: (port: number) => Promise<{ port: number, server: import("http").Server }>, workspaces: object }}
 */
export function createServer({ dataDir, seedRoot, distDir }) {
  const registryPath = path.join(dataDir, "workspaces.json");

  // First boot only: the seed root must exist to create workspaces.json.
  if (!fs.existsSync(registryPath)) {
    if (!fs.existsSync(seedRoot) || !fs.statSync(seedRoot).isDirectory()) {
      throw new Error(
        `Seed folder does not exist: ${seedRoot}. ` +
          `Set ROOT_DIR to the folder you want to edit, then restart.`
      );
    }
  }

  // --- SSE clients ------------------------------------------------------------
  const sseClients = new Set();
  function broadcast(event) {
    const payload = `data: ${JSON.stringify(event)}\n\n`;
    for (const res of sseClients) res.write(payload);
  }

  const workspaces = createWorkspaceManager({
    registryPath,
    seedRoot,
    onEvent: broadcast,
  });

  const app = express();
  app.use(express.json({ limit: "20mb" }));

  // Small async wrapper so route handlers can throw and get consistent errors.
  const h = (fn) => (req, res) =>
    Promise.resolve(fn(req, res)).catch((err) => {
      const status = err.status || 500;
      if (status >= 500) console.error(err);
      res.status(status).json({ error: err.message || "Server error" });
    });

  /** Resolve the workspace id from query or body to its root dir. */
  function wsOf(req) {
    const id = String(req.query.ws || req.body?.ws || "");
    return { id, root: workspaces.rootOf(id) };
  }

  // --- Workspaces -------------------------------------------------------------
  app.get(
    "/api/workspaces",
    h(async (_req, res) => {
      res.json({ workspaces: workspaces.list() });
    })
  );

  app.post(
    "/api/workspaces",
    h(async (req, res) => {
      const { name, root } = req.body || {};
      if (!root) throw Object.assign(new Error("Missing folder path"), { status: 400 });
      res.json(await workspaces.add(name, root));
    })
  );

  app.patch(
    "/api/workspaces/:id",
    h(async (req, res) => {
      res.json(workspaces.rename(req.params.id, req.body?.name));
    })
  );

  app.delete(
    "/api/workspaces/:id",
    h(async (req, res) => {
      workspaces.remove(req.params.id);
      res.json({ ok: true });
    })
  );

  // --- Files (all scoped by ?ws=) -----------------------------------------------
  app.get(
    "/api/tree",
    h(async (req, res) => {
      const { id, root } = wsOf(req);
      workspaces.ensureWatching(id);
      res.json({ tree: await listTree(root) });
    })
  );

  app.get(
    "/api/file",
    h(async (req, res) => {
      const { root } = wsOf(req);
      const { path: relPath } = req.query;
      if (!relPath) throw Object.assign(new Error("Missing path"), { status: 400 });
      res.json(await readFile(root, String(relPath)));
    })
  );

  app.put(
    "/api/file",
    h(async (req, res) => {
      const { id, root } = wsOf(req);
      const { path: relPath, content, baseMtimeMs } = req.body || {};
      if (!relPath) throw Object.assign(new Error("Missing path"), { status: 400 });
      if (typeof content !== "string") {
        throw Object.assign(new Error("Missing content"), { status: 400 });
      }
      workspaces.markSelfWrite(id, relPath);
      const result = await writeFile(root, relPath, content, baseMtimeMs);
      workspaces.links(id).invalidate();
      if (result.conflict) {
        return res.status(409).json(result);
      }
      res.json(result);
    })
  );

  app.post(
    "/api/file",
    h(async (req, res) => {
      const { root } = wsOf(req);
      const { path: relPath } = req.body || {};
      if (!relPath) throw Object.assign(new Error("Missing path"), { status: 400 });
      res.json(await createFile(root, relPath));
    })
  );

  app.post(
    "/api/folder",
    h(async (req, res) => {
      const { root } = wsOf(req);
      const { path: relPath } = req.body || {};
      if (!relPath) throw Object.assign(new Error("Missing path"), { status: 400 });
      await createFolder(root, relPath);
      res.json({ ok: true });
    })
  );

  app.patch(
    "/api/rename",
    h(async (req, res) => {
      const { root } = wsOf(req);
      const { from, to } = req.body || {};
      if (!from || !to) {
        throw Object.assign(new Error("Missing from/to"), { status: 400 });
      }
      await rename(root, from, to);
      res.json({ ok: true });
    })
  );

  app.delete(
    "/api/file",
    h(async (req, res) => {
      const { root } = wsOf(req);
      const relPath = req.query.path;
      if (!relPath) throw Object.assign(new Error("Missing path"), { status: 400 });
      await remove(root, String(relPath));
      res.json({ ok: true });
    })
  );

  // Raw file bytes, for previewing non-editable files (images) read-only.
  const RAW_MIME = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".bmp": "image/bmp",
    ".ico": "image/x-icon",
    ".pdf": "application/pdf",
  };
  app.get(
    "/api/raw",
    h(async (req, res) => {
      const { root } = wsOf(req);
      const relPath = String(req.query.path || "");
      if (!relPath) throw Object.assign(new Error("Missing path"), { status: 400 });
      const abs = safeResolve(root, relPath);
      const stat = await fsp.stat(abs).catch(() => null);
      if (!stat || !stat.isFile()) {
        throw Object.assign(new Error("Not found"), { status: 404 });
      }
      const mime = RAW_MIME[path.extname(abs).toLowerCase()] || "application/octet-stream";
      res.setHeader("Content-Type", mime);
      fs.createReadStream(abs).pipe(res);
    })
  );

  app.get(
    "/api/search",
    h(async (req, res) => {
      const { root } = wsOf(req);
      res.json({ results: await search(root, String(req.query.q || "")) });
    })
  );

  app.get(
    "/api/notes",
    h(async (req, res) => {
      const { id } = wsOf(req);
      res.json({ notes: await workspaces.links(id).getNotes() });
    })
  );

  app.get(
    "/api/backlinks",
    h(async (req, res) => {
      const { id } = wsOf(req);
      const relPath = String(req.query.path || "");
      if (!relPath) throw Object.assign(new Error("Missing path"), { status: 400 });
      res.json({ backlinks: await workspaces.links(id).getBacklinks(relPath) });
    })
  );

  // --- Comments (sidecar files, agent-readable) ----------------------------------
  app.get(
    "/api/comments",
    h(async (req, res) => {
      const { root } = wsOf(req);
      const relPath = String(req.query.path || "");
      if (!relPath) throw Object.assign(new Error("Missing path"), { status: 400 });
      res.json({ comments: await listComments(root, relPath) });
    })
  );

  app.post(
    "/api/comments",
    h(async (req, res) => {
      const { id, root } = wsOf(req);
      const { path: relPath, author, audience, text, anchor } = req.body || {};
      if (!relPath) throw Object.assign(new Error("Missing path"), { status: 400 });
      workspaces.markSelfWrite(id, sidecarFor(relPath));
      res.json(await addComment(root, relPath, { author, audience, text, anchor }));
    })
  );

  app.patch(
    "/api/comments",
    h(async (req, res) => {
      const { id, root } = wsOf(req);
      const { path: relPath, id: commentId, ...patch } = req.body || {};
      if (!relPath || !commentId) {
        throw Object.assign(new Error("Missing path/id"), { status: 400 });
      }
      workspaces.markSelfWrite(id, sidecarFor(relPath));
      res.json(await updateComment(root, relPath, commentId, patch));
    })
  );

  app.delete(
    "/api/comments",
    h(async (req, res) => {
      const { id, root } = wsOf(req);
      const relPath = String(req.query.path || "");
      const commentId = String(req.query.id || "");
      if (!relPath || !commentId) {
        throw Object.assign(new Error("Missing path/id"), { status: 400 });
      }
      workspaces.markSelfWrite(id, sidecarFor(relPath));
      await deleteComment(root, relPath, commentId);
      res.json({ ok: true });
    })
  );

  // --- Folder browser (for the Add Workspace picker) -----------------------------
  // Lists directories only, starting from the user's home folder. Includes
  // quick shortcuts to common locations (Documents, OneDrive, iCloud, …).
  app.get(
    "/api/browse",
    h(async (req, res) => {
      const home = os.homedir();
      const raw = String(req.query.path || "") || home;
      const dir = path.resolve(raw);

      let entries;
      try {
        entries = await fsp.readdir(dir, { withFileTypes: true });
      } catch {
        throw Object.assign(new Error(`Cannot open folder: ${dir}`), { status: 400 });
      }

      const dirs = entries
        .filter((e) => e.isDirectory() && !e.name.startsWith("."))
        .map((e) => ({ name: e.name, path: path.join(dir, e.name) }))
        .sort((a, b) =>
          a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
        );

      // Quick-access shortcuts that actually exist on this machine.
      const candidates = [
        { name: "Home", path: home },
        { name: "Documents", path: path.join(home, "Documents") },
        { name: "Desktop", path: path.join(home, "Desktop") },
        { name: "Downloads", path: path.join(home, "Downloads") },
      ];
      // OneDrive / cloud folders live under ~/Library/CloudStorage on macOS.
      const cloudRoot = path.join(home, "Library", "CloudStorage");
      try {
        for (const e of fs.readdirSync(cloudRoot, { withFileTypes: true })) {
          if (e.isDirectory()) {
            candidates.push({
              name: e.name.replace(/-/g, " "),
              path: path.join(cloudRoot, e.name),
            });
          }
        }
      } catch {
        /* not macOS or no cloud storage */
      }
      // Windows-style OneDrive folders directly under home.
      try {
        for (const e of fs.readdirSync(home, { withFileTypes: true })) {
          if (e.isDirectory() && /^OneDrive/i.test(e.name)) {
            candidates.push({ name: e.name, path: path.join(home, e.name) });
          }
        }
      } catch {
        /* ignore */
      }
      const shortcuts = candidates.filter((c) => {
        try {
          return fs.statSync(c.path).isDirectory();
        } catch {
          return false;
        }
      });

      res.json({
        path: dir,
        parent: path.dirname(dir) !== dir ? path.dirname(dir) : null,
        dirs,
        shortcuts,
      });
    })
  );

  // --- Misc --------------------------------------------------------------------
  app.get(
    "/api/info",
    h(async (req, res) => {
      const { root } = wsOf(req);
      res.json({ rootDir: root, rootName: path.basename(root) });
    })
  );

  // Install the agent-instructions template into a workspace root.
  app.post(
    "/api/agent-instructions",
    h(async (req, res) => {
      const { root } = wsOf(req);
      const { overwrite } = req.body || {};
      const target = path.join(root, "AGENTS.md");
      if (fs.existsSync(target) && !overwrite) {
        return res.status(409).json({ error: "AGENTS.md already exists", exists: true });
      }
      const template = fs.readFileSync(
        path.join(__dirname, "templates", "AGENTS-comments.md"),
        "utf8"
      );
      fs.writeFileSync(target, template, "utf8");
      res.json({ ok: true });
    })
  );

  // Server-sent events: {type:'tree'|'file'|'comments', path?, ws} on disk changes.
  app.get("/api/events", (req, res) => {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.write(": connected\n\n");
    sseClients.add(res);
    const heartbeat = setInterval(() => res.write(": ping\n\n"), 25000);
    req.on("close", () => {
      clearInterval(heartbeat);
      sseClients.delete(res);
    });
  });

  // Serve the built frontend when a dist dir is provided (production/desktop).
  if (distDir) {
    app.use(express.static(distDir));
    app.get("*", (_req, res) => res.sendFile(path.join(distDir, "index.html")));
  }

  /** Start listening. Pass port 0 to pick a free port; resolves with the real one. */
  function listen(port) {
    return new Promise((resolve, reject) => {
      const server = app
        .listen(port, "127.0.0.1", () => {
          resolve({ port: server.address().port, server });
        })
        .on("error", reject);
    });
  }

  return { app, listen, workspaces };
}
