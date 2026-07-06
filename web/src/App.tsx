import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  api,
  setActiveWorkspace,
  type TreeNode,
  type NoteRef,
  type Backlink,
  type SearchHit,
  type Workspace,
  type Comment,
  type CommentAnchor,
} from "./api";
import {
  parseProperties,
  serializeProperties,
  combine,
  type Property,
} from "./frontmatter";
import FileTree from "./components/FileTree";
import MilkdownEditor, {
  type SelectionForComment,
} from "./components/MilkdownEditor";
import CommandPalette, { type PaletteAction } from "./components/CommandPalette";
import ContextMenu, { type MenuItem } from "./components/ContextMenu";
import { ConfirmModal, InputModal } from "./components/Modal";
import Properties from "./components/Properties";
import Backlinks from "./components/Backlinks";
import WorkspaceSwitcher from "./components/WorkspaceSwitcher";
import CommentsPanel from "./components/CommentsPanel";
import CommentPopover from "./components/CommentPopover";
import Icon from "./components/Icon";
import { buildReviewHtml, sanitizeRenderedHtml } from "./reviewExport";

type SaveState = "saved" | "edited" | "saving" | "conflict" | "error";

interface OpenFile {
  path: string;
  body: string;
  fmRaw: string | null;
  fmParseable: boolean;
  props: Property[];
  baseMtime: number;
  loadSeq: number; // bump to force editor remount on external reload
}

interface MenuState {
  x: number;
  y: number;
  node: TreeNode | null; // null = root area
}

type ModalState =
  | { kind: "confirm-delete"; node: TreeNode }
  | { kind: "new-note"; dir: string }
  | { kind: "new-folder"; dir: string }
  | { kind: "add-workspace" }
  | { kind: "rename-workspace"; ws: Workspace }
  | { kind: "remove-workspace"; ws: Workspace }
  | { kind: "agents-overwrite"; ws: Workspace }
  | { kind: "display-name"; then?: () => void }
  | { kind: "delete-comment"; id: string }
  | null;

function sidecarFor(p: string) {
  return p.replace(/\.(md|markdown|mdown|txt)$/i, "") + ".comments.json";
}

const EDITABLE_RE = /\.(md|markdown|mdown|txt)$/i;
const IMAGE_RE = /\.(png|jpg|jpeg|gif|webp|svg|bmp|ico)$/i;

export default function App() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [wsId, setWsId] = useState<string>(
    () => localStorage.getItem("md-ws") || ""
  );
  const [recentWs, setRecentWs] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem("md-recent-ws") || "[]");
    } catch {
      return [];
    }
  });
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [notes, setNotes] = useState<NoteRef[]>([]);
  const [file, setFile] = useState<OpenFile | null>(null);
  const [preview, setPreview] = useState<string | null>(null); // read-only, non-editable file
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [conflict, setConflict] = useState<string | null>(null); // disk content
  const [externalUpdate, setExternalUpdate] = useState(false);
  const [backlinks, setBacklinks] = useState<Backlink[]>([]);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [modal, setModal] = useState<ModalState>(null);
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState(
    () => Number(localStorage.getItem("md-sidebar-w")) || 260
  );
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [dark, setDark] = useState(() => localStorage.getItem("md-dark") === "1");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchHit[] | null>(null);

  // Comments state
  const [comments, setComments] = useState<Comment[]>([]);
  const [activeCommentId, setActiveCommentId] = useState<string | null>(null);
  const [anchorsFound, setAnchorsFound] = useState<Record<string, boolean>>({});
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [pendingComment, setPendingComment] = useState<SelectionForComment | null>(null);
  const [displayName, setDisplayName] = useState(
    () => localStorage.getItem("md-name") || ""
  );

  // Refs for async callbacks.
  const fileRef = useRef(file);
  fileRef.current = file;
  const wsRef = useRef(wsId);
  wsRef.current = wsId;
  const dirtyRef = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ---- Boot: workspaces first, then the active one's tree ---------------------
  const refreshTree = useCallback(async () => {
    setTree(await api.tree());
    setNotes(await api.notes());
  }, []);

  useEffect(() => {
    api
      .workspaces()
      .then((list) => {
        setWorkspaces(list);
        const saved = localStorage.getItem("md-ws") || "";
        const valid = list.some((w) => w.id === saved) ? saved : list[0]?.id ?? "";
        setWsId(valid);
        setActiveWorkspace(valid);
        localStorage.setItem("md-ws", valid);
        return refreshTree();
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    document.body.classList.toggle("dark", dark);
    localStorage.setItem("md-dark", dark ? "1" : "0");
  }, [dark]);

  useEffect(() => {
    localStorage.setItem("md-sidebar-w", String(sidebarWidth));
  }, [sidebarWidth]);

  // Track workspace recency (most recent first) for the quick-switch list.
  useEffect(() => {
    if (!wsId) return;
    setRecentWs((prev) => {
      const next = [wsId, ...prev.filter((id) => id !== wsId)].slice(0, 8);
      localStorage.setItem("md-recent-ws", JSON.stringify(next));
      return next;
    });
  }, [wsId]);

  // ---- Compose + save -----------------------------------------------------------
  const compose = useCallback((f: OpenFile) => {
    const yaml = f.fmParseable
      ? f.props.length > 0
        ? serializeProperties(f.props)
        : null
      : f.fmRaw;
    return combine(yaml, f.body);
  }, []);

  const doSave = useCallback(
    async (force = false) => {
      const f = fileRef.current;
      if (!f || (!dirtyRef.current && !force)) return;
      setSaveState("saving");
      try {
        const res = await api.save(f.path, compose(f), force ? null : f.baseMtime);
        if (res.conflict) {
          setConflict(res.diskContent ?? "");
          setSaveState("conflict");
          return;
        }
        dirtyRef.current = false;
        setConflict(null);
        setFile((cur) =>
          cur && cur.path === f.path ? { ...cur, baseMtime: res.mtimeMs } : cur
        );
        setSaveState("saved");
        // Saving may add/remove links.
        api.backlinks(f.path).then(setBacklinks).catch(() => {});
      } catch (e) {
        setSaveState("error");
        console.error(e);
      }
    },
    [compose]
  );

  const scheduleSave = useCallback(() => {
    dirtyRef.current = true;
    setSaveState("edited");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => doSave(), 900);
  }, [doSave]);

  const flushSave = useCallback(async () => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    await doSave();
  }, [doSave]);

  // ---- Open file -------------------------------------------------------------------
  const loadComments = useCallback((path: string) => {
    api
      .comments(path)
      .then((list) => {
        setComments(list);
        if (list.some((c) => c.status === "open")) setCommentsOpen(true);
      })
      .catch(() => setComments([]));
  }, []);

  const openFile = useCallback(
    async (path: string) => {
      await flushSave();
      // Non-markdown files open read-only (no editor, no autosave).
      if (!EDITABLE_RE.test(path)) {
        setFile(null);
        setComments([]);
        setBacklinks([]);
        setResults(null);
        setQuery("");
        setPreview(path);
        return;
      }
      setPreview(null);
      try {
        const data = await api.read(path);
        const props = parseProperties(data.frontmatter);
        const fmParseable = data.frontmatter == null || props.length > 0;
        dirtyRef.current = false;
        setConflict(null);
        setExternalUpdate(false);
        setSaveState("saved");
        setActiveCommentId(null);
        setPendingComment(null);
        setFile((prev) => ({
          path,
          body: data.body,
          fmRaw: data.frontmatter,
          fmParseable,
          props,
          baseMtime: data.mtimeMs,
          loadSeq: (prev?.loadSeq ?? 0) + 1,
        }));
        setResults(null);
        setQuery("");
        api.backlinks(path).then(setBacklinks).catch(() => setBacklinks([]));
        loadComments(path);
      } catch (e) {
        console.error(e);
      }
    },
    [flushSave, loadComments]
  );

  // Resolve an href clicked inside the editor, relative to the open file.
  const openRelative = useCallback(
    (href: string) => {
      const f = fileRef.current;
      // Join with the current file's folder, then normalize "." and "..".
      const dir = f?.path.includes("/")
        ? f.path.slice(0, f.path.lastIndexOf("/"))
        : "";
      const joined = (dir ? dir + "/" : "") + href;
      const parts: string[] = [];
      for (const seg of joined.split("/")) {
        if (seg === "." || seg === "") continue;
        if (seg === "..") parts.pop();
        else parts.push(seg);
      }
      let target = parts.join("/");

      if (!notes.some((n) => n.path === target)) {
        // Maybe it was root-relative, or find by basename anywhere.
        const rootRel = href.replace(/^\.\//, "");
        if (notes.some((n) => n.path === rootRel)) {
          target = rootRel;
        } else {
          const base = href.split("/").pop()!.toLowerCase();
          const hit = notes.find((n) => n.name.toLowerCase() === base);
          if (hit) target = hit.path;
        }
      }
      openFile(target);
    },
    [notes, openFile]
  );

  // ---- Workspace switching ------------------------------------------------------
  const switchWorkspace = useCallback(
    async (id: string) => {
      if (id === wsRef.current) return;
      await flushSave();
      setWsId(id);
      setActiveWorkspace(id);
      localStorage.setItem("md-ws", id);
      setFile(null);
      setComments([]);
      setBacklinks([]);
      setResults(null);
      setQuery("");
      refreshTree().catch(() => {});
    },
    [flushSave, refreshTree]
  );

  const refreshWorkspaces = useCallback(async () => {
    setWorkspaces(await api.workspaces());
  }, []);

  // ---- Live folder watching --------------------------------------------------------
  useEffect(() => {
    const stop = api.watch((event) => {
      if (event.ws !== wsRef.current) return; // another workspace
      if (event.type === "tree") {
        refreshTree().catch(() => {});
        const f = fileRef.current;
        if (f) api.backlinks(f.path).then(setBacklinks).catch(() => {});
        return;
      }
      const f = fileRef.current;
      if (!f) return;

      if (event.type === "comments") {
        // An agent or teammate wrote the sidecar — refresh the panel live.
        if (event.path === sidecarFor(f.path)) loadComments(f.path);
        return;
      }

      // file changed on disk
      if (event.path !== f.path) return;
      if (dirtyRef.current) {
        setExternalUpdate(true); // don't clobber in-progress edits
      } else {
        // Clean: silently reload.
        api.read(f.path).then((data) => {
          const props = parseProperties(data.frontmatter);
          setFile((cur) =>
            cur && cur.path === f.path
              ? {
                  ...cur,
                  body: data.body,
                  fmRaw: data.frontmatter,
                  fmParseable: data.frontmatter == null || props.length > 0,
                  props,
                  baseMtime: data.mtimeMs,
                  loadSeq: cur.loadSeq + 1,
                }
              : cur
          );
        });
      }
    });
    return stop;
  }, [refreshTree, loadComments]);

  // ---- Comments actions ---------------------------------------------------------
  const requireName = useCallback(
    (then: () => void) => {
      if (displayName) then();
      else setModal({ kind: "display-name", then });
    },
    [displayName]
  );

  const submitComment = useCallback(
    (anchor: CommentAnchor, text: string, audience: "agent" | "team") => {
      const f = fileRef.current;
      if (!f) return;
      const name = localStorage.getItem("md-name") || "Anonymous";
      api
        .addComment(f.path, { author: name, audience, text, anchor })
        .then(() => {
          setPendingComment(null);
          setCommentsOpen(true);
          loadComments(f.path);
        })
        .catch((e) => alert((e as Error).message));
    },
    [loadComments]
  );

  const replyToComment = useCallback(
    (id: string, text: string) => {
      const f = fileRef.current;
      if (!f) return;
      requireName(() => {
        const name = localStorage.getItem("md-name") || "Anonymous";
        api
          .updateComment(f.path, id, { reply: { author: name, text } })
          .then(() => loadComments(f.path))
          .catch(() => {});
      });
    },
    [loadComments, requireName]
  );

  const setCommentStatus = useCallback(
    (id: string, status: "open" | "resolved") => {
      const f = fileRef.current;
      if (!f) return;
      api
        .updateComment(f.path, id, { status })
        .then(() => loadComments(f.path))
        .catch(() => {});
    },
    [loadComments]
  );

  const deleteComment = useCallback(
    (id: string) => {
      const f = fileRef.current;
      if (!f) return;
      api
        .deleteComment(f.path, id)
        .then(() => loadComments(f.path))
        .catch(() => {});
    },
    [loadComments]
  );

  const focusComment = useCallback((id: string | null) => {
    setActiveCommentId(id);
    if (id) {
      setCommentsOpen(true);
      // Scroll the card into view after the panel renders.
      setTimeout(() => {
        document
          .getElementById(`comment-${id}`)
          ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }, 60);
    }
  }, []);

  // ---- Keyboard shortcuts -----------------------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      const k = e.key.toLowerCase();
      if (k === "s") {
        e.preventDefault();
        flushSave();
      } else if (k === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      } else if (k === "n" && !e.shiftKey) {
        e.preventDefault();
        setModal({ kind: "new-note", dir: "" });
      } else if (e.key === "\\") {
        e.preventDefault();
        setSidebarOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [flushSave]);

  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (dirtyRef.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  // ---- Sidebar search (content search) ------------------------------------------------
  useEffect(() => {
    if (!query.trim()) {
      setResults(null);
      return;
    }
    const t = setTimeout(() => {
      api.search(query).then(setResults).catch(() => {});
    }, 200);
    return () => clearTimeout(t);
  }, [query]);

  // ---- File management ------------------------------------------------------------
  const createNote = useCallback(
    async (dir: string, name: string) => {
      const clean = /\.(md|markdown|txt)$/i.test(name) ? name : `${name}.md`;
      const rel = dir ? `${dir}/${clean}` : clean;
      try {
        await api.createFile(rel);
        await refreshTree();
        openFile(rel);
      } catch (e) {
        alert((e as Error).message);
      }
    },
    [refreshTree, openFile]
  );

  const createFolder = useCallback(
    async (dir: string, name: string) => {
      const rel = dir ? `${dir}/${name}` : name;
      try {
        await api.createFolder(rel);
        await refreshTree();
      } catch (e) {
        alert((e as Error).message);
      }
    },
    [refreshTree]
  );

  const renameNode = useCallback(
    async (node: TreeNode, newName: string) => {
      setRenamingPath(null);
      const dir = node.path.includes("/")
        ? node.path.slice(0, node.path.lastIndexOf("/"))
        : "";
      let clean = newName;
      if (node.type === "file" && !/\.[^.]+$/.test(clean)) {
        const ext = node.name.match(/\.[^.]+$/)?.[0] ?? ".md";
        clean += ext;
      }
      const dest = dir ? `${dir}/${clean}` : clean;
      if (dest === node.path) return;
      try {
        await api.rename(node.path, dest);
        const f = fileRef.current;
        if (f && f.path === node.path) {
          setFile({ ...f, path: dest });
        } else if (f && node.type === "dir" && f.path.startsWith(node.path + "/")) {
          setFile({ ...f, path: dest + f.path.slice(node.path.length) });
        }
        await refreshTree();
      } catch (e) {
        alert((e as Error).message);
      }
    },
    [refreshTree]
  );

  const deleteNode = useCallback(
    async (node: TreeNode) => {
      try {
        await api.remove(node.path);
        const f = fileRef.current;
        if (f && (f.path === node.path || f.path.startsWith(node.path + "/"))) {
          dirtyRef.current = false;
          setFile(null);
          setBacklinks([]);
          setComments([]);
        }
        await refreshTree();
      } catch (e) {
        alert((e as Error).message);
      }
    },
    [refreshTree]
  );

  // Rename via the big page title.
  const renameByTitle = useCallback(
    (newTitle: string) => {
      const f = fileRef.current;
      if (!f) return;
      const node: TreeNode = {
        type: "file",
        name: f.path.split("/").pop()!,
        path: f.path,
      };
      renameNode(node, newTitle);
    },
    [renameNode]
  );

  // ---- Stakeholder review: export a shareable copy, import feedback back --------
  const exportReview = useCallback(async () => {
    const f = fileRef.current;
    if (!f) return;
    await flushSave();
    const pm = document.querySelector(".milkdown .ProseMirror");
    if (!pm) {
      alert("Open a note to export a review copy.");
      return;
    }
    const base = f.path.split("/").pop()!;
    const title = base.replace(/\.[^.]+$/, "");
    const html = buildReviewHtml({
      title,
      contentHtml: sanitizeRenderedHtml(pm),
      draftFile: base,
    });
    const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${title} - review.html`;
    a.click();
    URL.revokeObjectURL(url);
  }, [flushSave]);

  const importReview = useCallback(() => {
    const f = fileRef.current;
    if (!f) return;
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json,.json";
    input.onchange = async () => {
      const picked = input.files?.[0];
      if (!picked) return;
      try {
        const data = JSON.parse(await picked.text());
        const base = f.path.split("/").pop()!;
        if (data.draft && data.draft !== base) {
          const ok = window.confirm(
            `This feedback is for "${data.draft}" but the open note is "${base}". Import anyway?`
          );
          if (!ok) return;
        }
        const reviewer = (data.reviewer || "Reviewer").toString();
        let added = 0;
        if (data.decision === "approved" || data.decision === "changes") {
          await api.addComment(f.path, {
            author: reviewer,
            audience: "team",
            text:
              data.decision === "approved"
                ? "Review decision: Approved this draft."
                : "Review decision: Requested changes.",
            anchor: null,
          });
          added++;
        }
        for (const c of Array.isArray(data.comments) ? data.comments : []) {
          if (!c || !c.text) continue;
          await api.addComment(f.path, {
            author: reviewer,
            audience: "team",
            text: String(c.text),
            anchor: c.anchor || null,
          });
          added++;
        }
        loadComments(f.path);
        setCommentsOpen(true);
        alert(`Imported ${added} item(s) from ${reviewer}.`);
      } catch {
        alert("Could not read that review file. Make sure it is a .review.json exported from DXEditor.");
      }
    };
    input.click();
  }, [loadComments]);

  // ---- Agent instructions install ---------------------------------------------------
  const installAgents = useCallback(
    async (ws: Workspace, overwrite = false) => {
      const prevWs = wsRef.current;
      // Install into the chosen workspace even if it's not active.
      setActiveWorkspace(ws.id);
      const res = await api.installAgentInstructions(overwrite);
      setActiveWorkspace(prevWs);
      if (!res.ok && res.exists) {
        setModal({ kind: "agents-overwrite", ws });
      } else if (!res.ok) {
        alert(res.error || "Could not write AGENTS.md");
      }
    },
    []
  );

  // ---- Context menu items ---------------------------------------------------------
  const menuItems = useMemo<MenuItem[]>(() => {
    if (!menu) return [];
    const node = menu.node;
    if (!node) {
      return [
        { label: "New note", icon: <Icon name="file-plus" size={15} />, onSelect: () => setModal({ kind: "new-note", dir: "" }) },
        { label: "New folder", icon: <Icon name="folder-plus" size={15} />, onSelect: () => setModal({ kind: "new-folder", dir: "" }) },
      ];
    }
    if (node.type === "dir") {
      return [
        { label: "New note", icon: <Icon name="file-plus" size={15} />, onSelect: () => setModal({ kind: "new-note", dir: node.path }) },
        { label: "New folder", icon: <Icon name="folder-plus" size={15} />, onSelect: () => setModal({ kind: "new-folder", dir: node.path }) },
        { label: "", divider: true },
        { label: "Rename", icon: <Icon name="pencil" size={15} />, onSelect: () => setRenamingPath(node.path) },
        { label: "Copy path", icon: <Icon name="link" size={15} />, onSelect: () => navigator.clipboard.writeText(node.path) },
        { label: "", divider: true },
        { label: "Delete", icon: <Icon name="trash" size={15} />, danger: true, onSelect: () => setModal({ kind: "confirm-delete", node }) },
      ];
    }
    return [
      { label: "Open", icon: <Icon name="book-open" size={15} />, onSelect: () => openFile(node.path) },
      { label: "", divider: true },
      { label: "Rename", icon: <Icon name="pencil" size={15} />, onSelect: () => setRenamingPath(node.path) },
      { label: "Copy path", icon: <Icon name="link" size={15} />, onSelect: () => navigator.clipboard.writeText(node.path) },
      { label: "", divider: true },
      { label: "Delete", icon: <Icon name="trash" size={15} />, danger: true, onSelect: () => setModal({ kind: "confirm-delete", node }) },
    ];
  }, [menu, openFile]);

  // ---- Palette actions ---------------------------------------------------------------
  const paletteActions = useMemo<PaletteAction[]>(
    () => [
      { id: "new-note", label: "New note", icon: <Icon name="file-plus" size={15} />, hint: "⌘N", run: () => setModal({ kind: "new-note", dir: "" }) },
      { id: "new-folder", label: "New folder", icon: <Icon name="folder-plus" size={15} />, run: () => setModal({ kind: "new-folder", dir: "" }) },
      { id: "add-ws", label: "Add workspace", icon: <Icon name="workspace" size={15} />, run: () => setModal({ kind: "add-workspace" }) },
      ...workspaces
        .filter((w) => w.id !== wsId)
        .map((w) => ({
          id: "ws-" + w.id,
          label: `Switch to ${w.name}`,
          icon: <Icon name="workspace" size={15} />,
          hint: w.root,
          run: () => switchWorkspace(w.id),
        })),
      { id: "theme", label: dark ? "Switch to light mode" : "Switch to dark mode", icon: <Icon name={dark ? "sun" : "moon"} size={15} />, run: () => setDark((d) => !d) },
      { id: "sidebar", label: sidebarOpen ? "Hide sidebar" : "Show sidebar", icon: <Icon name="panel-left" size={15} />, hint: "⌘\\", run: () => setSidebarOpen((o) => !o) },
      { id: "name", label: "Change display name", icon: <Icon name="user" size={15} />, hint: displayName || "not set", run: () => setModal({ kind: "display-name" }) },
      ...(file
        ? [
            { id: "comments", label: commentsOpen ? "Hide comments" : "Show comments", icon: <Icon name="message" size={15} />, run: () => setCommentsOpen((o) => !o) },
            { id: "export-review", label: "Export review copy for stakeholders", icon: <Icon name="share" size={15} />, run: () => exportReview() },
            { id: "import-review", label: "Import review feedback…", icon: <Icon name="download" size={15} />, run: () => importReview() },
            { id: "copy-path", label: "Copy path of current note", icon: <Icon name="link" size={15} />, run: () => navigator.clipboard.writeText(file.path) },
            { id: "save", label: "Save now", icon: <Icon name="check" size={15} />, hint: "⌘S", run: () => flushSave() },
          ]
        : []),
    ],
    [dark, sidebarOpen, file, flushSave, workspaces, wsId, switchWorkspace, displayName, commentsOpen, exportReview, importReview]
  );

  // ---- Sidebar resize ------------------------------------------------------------------
  const dragRef = useRef(false);
  useEffect(() => {
    const move = (e: MouseEvent) => {
      if (!dragRef.current) return;
      setSidebarWidth(Math.min(440, Math.max(200, e.clientX)));
    };
    const up = () => (dragRef.current = false);
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
  }, []);

  // ---- Render ------------------------------------------------------------------------------
  const activeWorkspace = workspaces.find((w) => w.id === wsId);
  const recentList = recentWs
    .filter((id) => id !== wsId)
    .map((id) => workspaces.find((w) => w.id === id))
    .filter((w): w is Workspace => !!w)
    .slice(0, 4);
  const title = file ? file.path.split("/").pop()!.replace(/\.[^.]+$/, "") : "";
  const breadcrumbPath = file?.path ?? preview;
  const breadcrumb = breadcrumbPath
    ? [activeWorkspace?.name ?? "", ...breadcrumbPath.split("/").slice(0, -1)].join(" / ")
    : "";
  const openCommentCount = comments.filter((c) => c.status === "open").length;

  const saveLabel = {
    saved: "Saved",
    edited: "Edited",
    saving: "Saving…",
    conflict: "Conflict",
    error: "Save failed",
  }[saveState];

  return (
    <div className="app">
      {sidebarOpen && (
        <aside className="sidebar" style={{ width: sidebarWidth }}>
          <div className="sidebar-head">
            <WorkspaceSwitcher
              workspaces={workspaces}
              activeId={wsId}
              onSwitch={switchWorkspace}
              onAdd={() => setModal({ kind: "add-workspace" })}
              onRename={(ws) => setModal({ kind: "rename-workspace", ws })}
              onRemove={(ws) => setModal({ kind: "remove-workspace", ws })}
              onInstallAgents={(ws) => installAgents(ws)}
            />
            <div className="sidebar-buttons">
              <button className="ghost icon-btn" title="New note (⌘N)" onClick={() => setModal({ kind: "new-note", dir: "" })}><Icon name="file-plus" /></button>
              <button className="ghost icon-btn" title="New folder" onClick={() => setModal({ kind: "new-folder", dir: "" })}><Icon name="folder-plus" /></button>
              <button className="ghost icon-btn" title="Search everything (⌘K)" onClick={() => setPaletteOpen(true)}><Icon name="search" /></button>
            </div>
            <input
              className="side-search"
              placeholder="Search in notes…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>

          <div
            className="tree-scroll"
            onContextMenu={(e) => {
              if (e.target === e.currentTarget) {
                e.preventDefault();
                setMenu({ x: e.clientX, y: e.clientY, node: null });
              }
            }}
          >
            {results ? (
              <ul className="search-results">
                {results.length === 0 && <li className="empty">No matches</li>}
                {results.map((r) => (
                  <li key={r.path} onClick={() => openFile(r.path)}>
                    <div className="sr-name">📄 {r.name.replace(/\.[^.]+$/, "")}</div>
                    {r.snippet && <div className="sr-snippet">{r.snippet}</div>}
                  </li>
                ))}
              </ul>
            ) : (
              <FileTree
                nodes={tree}
                activePath={file?.path ?? preview}
                renamingPath={renamingPath}
                onOpen={openFile}
                onMenu={(e, node) => {
                  e.preventDefault();
                  setMenu({ x: e.clientX, y: e.clientY, node });
                }}
                onRenameSubmit={renameNode}
                onRenameCancel={() => setRenamingPath(null)}
              />
            )}
          </div>
          {recentList.length > 0 && (
            <div className="sidebar-recent">
              <div className="recent-label">Recent workspaces</div>
              {recentList.map((w) => (
                <button
                  key={w.id}
                  className="recent-item"
                  title={w.root}
                  onClick={() => switchWorkspace(w.id)}
                >
                  <span className="recent-icon"><Icon name="workspace" size={14} /></span>
                  <span className="recent-name">{w.name}</span>
                </button>
              ))}
            </div>
          )}
          <div className="resizer" onMouseDown={() => (dragRef.current = true)} />
        </aside>
      )}

      <main className="main">
        <header className="topbar">
          <div className="topbar-left">
            <button
              className="ghost icon-btn"
              title="Toggle sidebar (⌘\)"
              onClick={() => setSidebarOpen((o) => !o)}
            >
              <Icon name="panel-left" />
            </button>
            <span className="breadcrumb">{breadcrumb}</span>
          </div>
          <div className="topbar-right">
            {file && (
              <span className={"save-state " + saveState}>{saveLabel}</span>
            )}
            {file && (
              <button
                className="ghost icon-btn"
                title="Share for stakeholder review"
                onClick={exportReview}
              >
                <Icon name="share" />
              </button>
            )}
            {file && (
              <button
                className={"ghost icon-btn comments-toggle" + (commentsOpen ? " on" : "")}
                title="Comments"
                onClick={() => setCommentsOpen((o) => !o)}
              >
                <Icon name="message" />
                {openCommentCount > 0 && <span className="badge">{openCommentCount}</span>}
              </button>
            )}
            <button className="ghost icon-btn" title="Toggle theme" onClick={() => setDark((d) => !d)}>
              <Icon name={dark ? "sun" : "moon"} />
            </button>
          </div>
        </header>

        {conflict != null && file && (
          <div className="banner conflict-banner">
            <span>
              This note changed on disk — likely a teammate's edit synced by
              OneDrive.
            </span>
            <div className="banner-actions">
              <button
                className="btn"
                onClick={() => {
                  setConflict(null);
                  openFile(file.path); // reload theirs
                }}
              >
                Take theirs
              </button>
              <button
                className="btn primary"
                onClick={() => {
                  setConflict(null);
                  doSave(true); // force overwrite
                }}
              >
                Keep mine
              </button>
            </div>
          </div>
        )}

        {externalUpdate && file && conflict == null && (
          <div className="banner update-banner">
            <span>This note was updated in OneDrive while you were editing.</span>
            <div className="banner-actions">
              <button className="btn" onClick={() => setExternalUpdate(false)}>
                Keep editing
              </button>
              <button
                className="btn primary"
                onClick={() => {
                  setExternalUpdate(false);
                  openFile(file.path);
                }}
              >
                Reload their version
              </button>
            </div>
          </div>
        )}

        <div className="content-row">
          {file ? (
            <div className="page">
              <div className="page-inner">
                <input
                  className="page-title"
                  defaultValue={title}
                  key={file.path}
                  spellCheck={false}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                    if (e.key === "Escape") {
                      (e.target as HTMLInputElement).value = title;
                      (e.target as HTMLInputElement).blur();
                    }
                  }}
                  onBlur={(e) => {
                    const v = e.target.value.trim();
                    if (v && v !== title) renameByTitle(v);
                    else e.target.value = title;
                  }}
                />
                <Properties
                  properties={file.props}
                  onChange={(props) => {
                    setFile((cur) =>
                      cur ? { ...cur, props, fmParseable: true } : cur
                    );
                    scheduleSave();
                  }}
                />
                <MilkdownEditor
                  key={file.path + ":" + file.loadSeq}
                  path={file.path}
                  initialBody={file.body}
                  notes={notes}
                  comments={comments}
                  activeCommentId={activeCommentId}
                  onChange={(md) => {
                    setFile((cur) => (cur ? { ...cur, body: md } : cur));
                    scheduleSave();
                  }}
                  onOpenNote={openRelative}
                  onSelectForComment={(sel) =>
                    requireName(() => setPendingComment(sel))
                  }
                  onCommentClick={focusComment}
                  onAnchorsComputed={setAnchorsFound}
                />
                <Backlinks backlinks={backlinks} onOpen={openFile} />
              </div>
            </div>
          ) : preview ? (
            <div className="page">
              <div className="page-inner">
                <div className="readonly-preview">
                  <div className="readonly-name">
                    {preview.split("/").pop()}
                  </div>
                  {IMAGE_RE.test(preview) ? (
                    <img
                      className="preview-image"
                      src={api.rawUrl(preview)}
                      alt={preview.split("/").pop()}
                    />
                  ) : (
                    <div className="preview-placeholder">
                      <div className="preview-icon"><Icon name="paperclip" size={30} strokeWidth={1.5} /></div>
                      <p>Preview not available for this file type.</p>
                      <p className="muted">
                        It's shown here so the folder structure matches what's on
                        disk. This tool edits Markdown and text files.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="empty-state">
              <div className="empty-card">
                <img className="empty-logo-img light-only" src="/logo-lockup-dark.svg" alt="DXEditor" />
                <img className="empty-logo-img dark-only" src="/logo-lockup-light.svg" alt="DXEditor" />
                <p>Open a note from the sidebar,</p>
                <p>
                  or press <kbd>⌘K</kbd> to search and <kbd>⌘N</kbd> to create.
                </p>
              </div>
            </div>
          )}

          {file && commentsOpen && (
            <CommentsPanel
              comments={comments}
              activeId={activeCommentId}
              anchorsFound={anchorsFound}
              onFocus={setActiveCommentId}
              onReply={replyToComment}
              onSetStatus={setCommentStatus}
              onDelete={(id) => setModal({ kind: "delete-comment", id })}
              onClose={() => setCommentsOpen(false)}
            />
          )}
        </div>
      </main>

      {pendingComment && (
        <CommentPopover
          x={pendingComment.x}
          y={pendingComment.y}
          quote={pendingComment.anchor.quote}
          onSubmit={(text, audience) =>
            submitComment(pendingComment.anchor, text, audience)
          }
          onCancel={() => setPendingComment(null)}
        />
      )}

      {paletteOpen && (
        <CommandPalette
          notes={notes}
          actions={paletteActions}
          onOpenNote={openFile}
          onClose={() => setPaletteOpen(false)}
        />
      )}

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={menuItems}
          onClose={() => setMenu(null)}
        />
      )}

      {modal?.kind === "confirm-delete" && (
        <ConfirmModal
          title={`Delete "${modal.node.name}"?`}
          message={
            modal.node.type === "dir"
              ? "The folder and everything inside it will be deleted. This cannot be undone."
              : "This note (and its comments) will be permanently deleted. This cannot be undone."
          }
          confirmLabel="Delete"
          danger
          onConfirm={() => {
            deleteNode(modal.node);
            setModal(null);
          }}
          onCancel={() => setModal(null)}
        />
      )}

      {modal?.kind === "new-note" && (
        <InputModal
          title="New note"
          placeholder="Note title"
          initialValue="Untitled.md"
          onSubmit={(name) => {
            setModal(null);
            createNote(modal.dir, name);
          }}
          onCancel={() => setModal(null)}
        />
      )}

      {modal?.kind === "new-folder" && (
        <InputModal
          title="New folder"
          placeholder="Folder name"
          onSubmit={(name) => {
            setModal(null);
            createFolder(modal.dir, name);
          }}
          onCancel={() => setModal(null)}
        />
      )}

      {modal?.kind === "add-workspace" && (
        <AddWorkspaceModal
          onSubmit={async (name, root) => {
            try {
              const ws = await api.addWorkspace(name, root);
              setModal(null);
              await refreshWorkspaces();
              switchWorkspace(ws.id);
            } catch (e) {
              alert((e as Error).message);
            }
          }}
          onCancel={() => setModal(null)}
        />
      )}

      {modal?.kind === "rename-workspace" && (
        <InputModal
          title="Rename workspace"
          initialValue={modal.ws.name}
          confirmLabel="Rename"
          onSubmit={async (name) => {
            setModal(null);
            await api.renameWorkspace(modal.ws.id, name);
            refreshWorkspaces();
          }}
          onCancel={() => setModal(null)}
        />
      )}

      {modal?.kind === "remove-workspace" && (
        <ConfirmModal
          title={`Remove "${modal.ws.name}" from workspaces?`}
          message="This only removes it from the list. The folder and all its files stay exactly where they are."
          confirmLabel="Remove"
          onConfirm={async () => {
            setModal(null);
            await api.removeWorkspace(modal.ws.id);
            const list = await api.workspaces();
            setWorkspaces(list);
            if (modal.ws.id === wsRef.current && list[0]) {
              switchWorkspace(list[0].id);
            }
          }}
          onCancel={() => setModal(null)}
        />
      )}

      {modal?.kind === "agents-overwrite" && (
        <ConfirmModal
          title="AGENTS.md already exists"
          message={`"${modal.ws.name}" already has an AGENTS.md. Replace it with the comments-workflow template?`}
          confirmLabel="Replace"
          danger
          onConfirm={() => {
            setModal(null);
            installAgents(modal.ws, true);
          }}
          onCancel={() => setModal(null)}
        />
      )}

      {modal?.kind === "display-name" && (
        <InputModal
          title="Your name"
          placeholder="Shown on your comments (e.g. Nelson)"
          initialValue={displayName}
          confirmLabel="Save"
          onSubmit={(name) => {
            localStorage.setItem("md-name", name);
            setDisplayName(name);
            const then = modal.then;
            setModal(null);
            then?.();
          }}
          onCancel={() => setModal(null)}
        />
      )}

      {modal?.kind === "delete-comment" && (
        <ConfirmModal
          title="Delete this comment?"
          message="The comment and its replies will be removed. This cannot be undone."
          confirmLabel="Delete"
          danger
          onConfirm={() => {
            deleteComment(modal.id);
            setModal(null);
          }}
          onCancel={() => setModal(null)}
        />
      )}
    </div>
  );
}

/** Add-workspace modal with a built-in folder browser — no typing paths. */
function AddWorkspaceModal({
  onSubmit,
  onCancel,
}: {
  onSubmit: (name: string, root: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [nameTouched, setNameTouched] = useState(false);
  const [browse, setBrowse] = useState<import("./api").BrowseResult | null>(null);
  const [error, setError] = useState("");

  const go = useCallback((path?: string) => {
    api
      .browse(path)
      .then((r) => {
        setBrowse(r);
        setError("");
      })
      .catch((e) => setError((e as Error).message));
  }, []);

  useEffect(() => go(), [go]);

  const folderName = browse?.path.split("/").filter(Boolean).pop() ?? "";
  const effectiveName = nameTouched && name.trim() ? name.trim() : folderName;

  return (
    <div className="modal-backdrop" onMouseDown={onCancel}>
      <div className="modal modal-wide" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-title">Add workspace</div>
        <div className="modal-message">
          Choose the folder to connect — a personal drafts folder or a shared
          OneDrive folder.
        </div>

        {browse && (
          <>
            <div className="fb-shortcuts">
              {browse.shortcuts.map((s) => (
                <button
                  key={s.path}
                  className={"fb-shortcut" + (browse.path === s.path ? " on" : "")}
                  onClick={() => go(s.path)}
                >
                  {s.name}
                </button>
              ))}
            </div>

            <div className="fb-pathbar">
              <button
                className="ghost"
                disabled={!browse.parent}
                title="Up one level"
                onClick={() => browse.parent && go(browse.parent)}
              >
                ↑
              </button>
              <span className="fb-path" title={browse.path}>
                {browse.path}
              </span>
            </div>

            <div className="fb-list">
              {browse.dirs.length === 0 && (
                <div className="fb-empty">No subfolders</div>
              )}
              {browse.dirs.map((d) => (
                <div className="fb-dir" key={d.path} onClick={() => go(d.path)}>
                  📁 {d.name}
                </div>
              ))}
            </div>
          </>
        )}

        {error && <div className="fb-error">{error}</div>}

        <input
          className="modal-input"
          placeholder={folderName ? `Name (default: ${folderName})` : "Workspace name"}
          value={nameTouched ? name : ""}
          onChange={(e) => {
            setName(e.target.value);
            setNameTouched(true);
          }}
        />

        <div className="modal-actions">
          <button className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button
            className="btn primary"
            disabled={!browse}
            onClick={() => browse && onSubmit(effectiveName, browse.path)}
          >
            Use “{folderName || "…"}”
          </button>
        </div>
      </div>
    </div>
  );
}
