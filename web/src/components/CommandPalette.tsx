import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { NoteRef } from "../api";
import { fuzzyMatch } from "../fuzzy";
import Icon from "./Icon";

export interface PaletteAction {
  id: string;
  label: string;
  icon?: ReactNode;
  hint?: string;
  run: () => void;
}

interface Props {
  notes: NoteRef[];
  actions: PaletteAction[];
  onOpenNote: (path: string) => void;
  onClose: () => void;
}

type Row =
  | { kind: "note"; note: NoteRef }
  | { kind: "action"; action: PaletteAction };

/** Cmd+K command palette: fuzzy note jump + app actions. */
export default function CommandPalette({ notes, actions, onOpenNote, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => inputRef.current?.focus(), []);
  useEffect(() => setIndex(0), [query]);

  const rows = useMemo<Row[]>(() => {
    const noteRows = notes
      .map((n) => ({ n, score: fuzzyMatch(query, n.name + " " + n.path) }))
      .filter((s) => s.score > -1)
      .sort((a, b) => b.score - a.score)
      .slice(0, 10)
      .map((s) => ({ kind: "note" as const, note: s.n }));

    const actionRows = actions
      .map((a) => ({ a, score: fuzzyMatch(query, a.label) }))
      .filter((s) => s.score > -1)
      .sort((a, b) => b.score - a.score)
      .slice(0, 6)
      .map((s) => ({ kind: "action" as const, action: s.a }));

    // With no query: actions first (quick access); with query: notes first.
    return query.trim() ? [...noteRows, ...actionRows] : [...actionRows, ...noteRows];
  }, [notes, actions, query]);

  function activate(row: Row) {
    onClose();
    if (row.kind === "note") onOpenNote(row.note.path);
    else row.action.run();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setIndex((i) => Math.min(i + 1, rows.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (rows[index]) activate(rows[index]);
    } else if (e.key === "Escape") {
      onClose();
    }
  }

  // Keep the active row visible.
  useEffect(() => {
    listRef.current
      ?.querySelector(".pal-item.active")
      ?.scrollIntoView({ block: "nearest" });
  }, [index]);

  return (
    <div className="modal-backdrop palette-backdrop" onMouseDown={onClose}>
      <div className="palette" onMouseDown={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="palette-input"
          placeholder="Search notes or type a command…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <div className="palette-list" ref={listRef}>
          {rows.length === 0 && <div className="pal-empty">No results</div>}
          {rows.map((row, i) => (
            <div
              key={row.kind === "note" ? "n:" + row.note.path : "a:" + row.action.id}
              className={"pal-item" + (i === index ? " active" : "")}
              onMouseDown={(e) => {
                e.preventDefault();
                activate(row);
              }}
              onMouseEnter={() => setIndex(i)}
            >
              {row.kind === "note" ? (
                <>
                  <span className="pal-icon"><Icon name="file" size={15} /></span>
                  <span className="pal-label">
                    {row.note.name.replace(/\.[^.]+$/, "")}
                  </span>
                  <span className="pal-hint">{row.note.path}</span>
                </>
              ) : (
                <>
                  <span className="pal-icon">
                    {row.action.icon || <Icon name="sliders" size={15} />}
                  </span>
                  <span className="pal-label">{row.action.label}</span>
                  {row.action.hint && (
                    <span className="pal-hint">{row.action.hint}</span>
                  )}
                </>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
