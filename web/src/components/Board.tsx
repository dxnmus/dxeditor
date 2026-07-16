import { useEffect, useMemo, useState } from "react";
import { api, type Task } from "../api";
import Icon from "./Icon";

// The board renders task cards (files with `type: task` frontmatter) as columns.
// It can group by status (kanban) or by phase (pipeline) — same data, two lenses.

type GroupBy = "status" | "phase";

const STATUS_ORDER = ["planned", "building", "built"];
const STATUS_LABEL: Record<string, string> = {
  planned: "Planned",
  building: "Building",
  built: "Built",
};
const PHASE_LABEL: Record<string, string> = {
  "0": "Phase 0 · Discovery",
  "1": "Phase 1 · Topic alignment",
  "2": "Phase 2 · Drafts",
  "3": "Phase 3 · Revision · build · publish",
};

function ownerBadges(owner: string) {
  return owner
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
}

function ownerClass(owner: string) {
  const key = owner.toLowerCase();
  if (key === "dx") return "b-dx";
  if (key === "ae") return "b-ae";
  if (key === "sme") return "b-sme";
  return "b-other";
}

function statusClass(status: string) {
  const key = status.toLowerCase();
  if (key === "built") return "s-built";
  if (key === "building") return "s-building";
  return "s-planned";
}

interface Column {
  key: string;
  label: string;
  tasks: Task[];
}

function buildColumns(tasks: Task[], groupBy: GroupBy): Column[] {
  const buckets = new Map<string, Task[]>();
  for (const t of tasks) {
    const raw = groupBy === "status" ? t.status : t.phase;
    const key = raw == null || raw === "" ? "—" : String(raw);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(t);
  }

  // Preferred order first, then anything else alphabetically/numerically.
  const preferred = groupBy === "status" ? STATUS_ORDER : ["0", "1", "2", "3"];
  const seen = new Set<string>();
  const keys: string[] = [];
  for (const k of preferred) {
    if (buckets.has(k)) {
      keys.push(k);
      seen.add(k);
    }
  }
  for (const k of [...buckets.keys()].sort()) {
    if (!seen.has(k)) keys.push(k);
  }

  const labelFor = (key: string) => {
    if (key === "—") return "Unassigned";
    if (groupBy === "status") return STATUS_LABEL[key.toLowerCase()] ?? key;
    return PHASE_LABEL[key] ?? `Phase ${key}`;
  };

  return keys.map((key) => ({
    key,
    label: labelFor(key),
    tasks: buckets
      .get(key)!
      .slice()
      .sort((a, b) => a.order - b.order || a.title.localeCompare(b.title)),
  }));
}

export default function Board({
  reloadToken,
  onOpen,
}: {
  reloadToken: number;
  onOpen: (path: string) => void;
}) {
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [groupBy, setGroupBy] = useState<GroupBy>("status");
  const [draggedPath, setDraggedPath] = useState<string | null>(null);
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .board()
      .then((t) => {
        if (alive) {
          setTasks(t);
          setError(null);
        }
      })
      .catch((e) => {
        if (alive) setError(String(e?.message ?? e));
      });
    return () => {
      alive = false;
    };
  }, [reloadToken]);

  const columns = useMemo(
    () => (tasks ? buildColumns(tasks, groupBy) : []),
    [tasks, groupBy]
  );

  function moveTask(path: string, colKey: string) {
    if (colKey === "—") return; // "Unassigned" isn't a real target
    const field = groupBy; // dropping regroups by whichever lens is active
    const nextValue: string | number =
      field === "phase" && /^\d+$/.test(colKey) ? Number(colKey) : colKey;
    // Optimistic move; the file-watcher refetch will confirm it.
    setTasks((prev) =>
      prev
        ? prev.map((t) => (t.path === path ? { ...t, [field]: nextValue } : t))
        : prev
    );
    api.updateTask(path, field, colKey).catch(() => {
      api.board().then(setTasks).catch(() => {});
    });
  }

  return (
    <div className="board">
      <div className="board-head">
        <div className="board-title">
          <Icon name="sliders" size={17} strokeWidth={1.75} />
          <span>Board</span>
          {tasks && <span className="board-count">{tasks.length}</span>}
        </div>
        <div className="board-groupby">
          <span className="board-groupby-label">Group by</span>
          <div className="board-toggle">
            <button
              className={groupBy === "status" ? "on" : ""}
              onClick={() => setGroupBy("status")}
            >
              Status
            </button>
            <button
              className={groupBy === "phase" ? "on" : ""}
              onClick={() => setGroupBy("phase")}
            >
              Phase
            </button>
          </div>
        </div>
      </div>

      {error ? (
        <div className="board-empty">Couldn't load the board: {error}</div>
      ) : !tasks ? (
        <div className="board-empty">Loading…</div>
      ) : tasks.length === 0 ? (
        <div className="board-empty">
          No task cards yet. Add <code>type: task</code> to a note's frontmatter
          (with <code>status</code>, <code>phase</code>, <code>owner</code>) and
          it shows up here.
        </div>
      ) : (
        <div className="board-columns">
          {columns.map((col) => (
            <div
              className={
                "board-col" +
                (dragOverKey === col.key && col.key !== "—" ? " drag-over" : "")
              }
              key={col.key}
              onDragOver={(e) => {
                if (draggedPath && col.key !== "—") {
                  e.preventDefault();
                  setDragOverKey(col.key);
                }
              }}
              onDragLeave={(e) => {
                if (e.currentTarget === e.target) setDragOverKey(null);
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (draggedPath) moveTask(draggedPath, col.key);
                setDraggedPath(null);
                setDragOverKey(null);
              }}
            >
              <div className="board-col-head">
                {groupBy === "status" && (
                  <span className={"board-dot " + statusClass(col.key)} />
                )}
                <span className="board-col-name">{col.label}</span>
                <span className="board-col-count">{col.tasks.length}</span>
              </div>
              <div className="board-col-body">
                {col.tasks.map((t) => (
                  <button
                    className={
                      "board-card" + (draggedPath === t.path ? " dragging" : "")
                    }
                    key={t.path}
                    draggable
                    onDragStart={() => setDraggedPath(t.path)}
                    onDragEnd={() => {
                      setDraggedPath(null);
                      setDragOverKey(null);
                    }}
                    onClick={() => onOpen(t.path)}
                    title={t.path}
                  >
                    <div className="board-card-title">{t.title}</div>
                    <div className="board-card-meta">
                      {ownerBadges(t.owner).map((o) => (
                        <span className={"board-badge " + ownerClass(o)} key={o}>
                          {o}
                        </span>
                      ))}
                      {groupBy === "status" && t.phase != null && t.phase !== "" && (
                        <span className="board-phase">P{String(t.phase)}</span>
                      )}
                      {groupBy === "phase" && (
                        <span className={"board-status " + statusClass(t.status)}>
                          {STATUS_LABEL[t.status.toLowerCase()] ?? t.status}
                        </span>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
