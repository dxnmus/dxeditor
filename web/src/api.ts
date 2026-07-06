// Thin client for the backend file API. Everything the app knows about "where
// files live" is behind this module — swap these for Tauri fs calls later to
// ship a desktop app without touching the UI.

export type TreeNode =
  | { type: "file"; name: string; path: string; editable?: boolean }
  | { type: "dir"; name: string; path: string; children: TreeNode[] };

export interface FileData {
  content: string;
  frontmatter: string | null;
  body: string;
  mtimeMs: number;
}

export interface SaveResult {
  conflict: boolean;
  mtimeMs: number;
  diskContent?: string;
}

export interface SearchHit {
  path: string;
  name: string;
  snippet: string | null;
}

export interface NoteRef {
  path: string;
  name: string;
}

export interface Backlink {
  path: string;
  name: string;
  snippet: string;
}

export interface Workspace {
  id: string;
  name: string;
  root: string;
}

export interface CommentAnchor {
  quote: string;
  prefix: string;
  suffix: string;
}

export interface CommentReply {
  author: string;
  text: string;
  createdAt: string;
}

export interface Comment {
  id: string;
  author: string;
  for: "agent" | "team";
  status: "open" | "resolved";
  createdAt: string;
  anchor: CommentAnchor | null;
  text: string;
  replies: CommentReply[];
}

export interface BrowseResult {
  path: string;
  parent: string | null;
  dirs: { name: string; path: string }[];
  shortcuts: { name: string; path: string }[];
}

export type WatchEvent =
  | { type: "tree"; ws: string }
  | { type: "file"; path: string; ws: string }
  | { type: "comments"; path: string; ws: string };

// Active workspace id — set by the app, appended to every request.
let activeWs = "";
export function setActiveWorkspace(id: string) {
  activeWs = id;
}

function withWs(url: string): string {
  if (!activeWs) return url;
  return url + (url.includes("?") ? "&" : "?") + "ws=" + encodeURIComponent(activeWs);
}

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(withWs(url), {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok && res.status !== 409) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data as T;
}

export const api = {
  info: () => req<{ rootDir: string; rootName: string }>("/api/info"),

  // --- Workspaces (not ws-scoped) -----------------------------------------
  workspaces: () =>
    req<{ workspaces: Workspace[] }>("/api/workspaces").then((r) => r.workspaces),

  addWorkspace: (name: string, root: string) =>
    req<Workspace>("/api/workspaces", {
      method: "POST",
      body: JSON.stringify({ name, root }),
    }),

  renameWorkspace: (id: string, name: string) =>
    req<Workspace>(`/api/workspaces/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ name }),
    }),

  removeWorkspace: (id: string) =>
    req<{ ok: true }>(`/api/workspaces/${id}`, { method: "DELETE" }),

  // --- Files -----------------------------------------------------------------
  tree: () => req<{ tree: TreeNode[] }>("/api/tree").then((r) => r.tree),

  read: (path: string) =>
    req<FileData>(`/api/file?path=${encodeURIComponent(path)}`),

  save: (path: string, content: string, baseMtimeMs: number | null) =>
    req<SaveResult>("/api/file", {
      method: "PUT",
      body: JSON.stringify({ path, content, baseMtimeMs }),
    }),

  createFile: (path: string) =>
    req<{ mtimeMs: number }>("/api/file", {
      method: "POST",
      body: JSON.stringify({ path }),
    }),

  createFolder: (path: string) =>
    req<{ ok: true }>("/api/folder", {
      method: "POST",
      body: JSON.stringify({ path }),
    }),

  rename: (from: string, to: string) =>
    req<{ ok: true }>("/api/rename", {
      method: "PATCH",
      body: JSON.stringify({ from, to }),
    }),

  remove: (path: string) =>
    req<{ ok: true }>(`/api/file?path=${encodeURIComponent(path)}`, {
      method: "DELETE",
    }),

  search: (q: string) =>
    req<{ results: SearchHit[] }>(`/api/search?q=${encodeURIComponent(q)}`).then(
      (r) => r.results
    ),

  notes: () => req<{ notes: NoteRef[] }>("/api/notes").then((r) => r.notes),

  backlinks: (path: string) =>
    req<{ backlinks: Backlink[] }>(
      `/api/backlinks?path=${encodeURIComponent(path)}`
    ).then((r) => r.backlinks),

  // --- Comments ---------------------------------------------------------------
  comments: (path: string) =>
    req<{ comments: Comment[] }>(
      `/api/comments?path=${encodeURIComponent(path)}`
    ).then((r) => r.comments),

  addComment: (
    path: string,
    data: {
      author: string;
      audience: "agent" | "team";
      text: string;
      anchor: CommentAnchor | null;
    }
  ) =>
    req<Comment>("/api/comments", {
      method: "POST",
      body: JSON.stringify({ path, ...data }),
    }),

  updateComment: (
    path: string,
    id: string,
    patch: {
      status?: "open" | "resolved";
      text?: string;
      reply?: { author: string; text: string };
    }
  ) =>
    req<Comment>("/api/comments", {
      method: "PATCH",
      body: JSON.stringify({ path, id, ...patch }),
    }),

  deleteComment: (path: string, id: string) =>
    req<{ ok: true }>(
      `/api/comments?path=${encodeURIComponent(path)}&id=${encodeURIComponent(id)}`,
      { method: "DELETE" }
    ),

  // Raw URL for previewing a non-editable file (image) read-only.
  rawUrl: (path: string) => withWs(`/api/raw?path=${encodeURIComponent(path)}`),

  // --- Folder browser (Add Workspace picker) ------------------------------------
  browse: (path?: string) =>
    req<BrowseResult>(
      "/api/browse" + (path ? `?path=${encodeURIComponent(path)}` : "")
    ),

  // --- Agent instructions -------------------------------------------------------
  installAgentInstructions: (overwrite = false) =>
    fetch(withWs("/api/agent-instructions"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ overwrite }),
    }).then(async (res) => {
      const data = await res.json().catch(() => ({}));
      return { ok: res.ok, exists: !!data.exists, error: data.error as string | undefined };
    }),

  /** Subscribe to folder-change events (all workspaces; filter by ws). */
  watch(onEvent: (e: WatchEvent) => void): () => void {
    const source = new EventSource("/api/events");
    source.onmessage = (msg) => {
      try {
        onEvent(JSON.parse(msg.data));
      } catch {
        /* ignore malformed events */
      }
    };
    return () => source.close();
  },
};
