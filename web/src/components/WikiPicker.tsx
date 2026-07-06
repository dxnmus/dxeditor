import { useEffect, useMemo, useState } from "react";
import type { NoteRef } from "../api";
import { fuzzyMatch } from "../fuzzy";

interface Props {
  x: number;
  y: number;
  filter: string;
  notes: NoteRef[];
  onPick: (note: NoteRef) => void;
  onClose: () => void;
}

/** Floating note picker shown when the user types "[[" in the editor. */
export default function WikiPicker({ x, y, filter, notes, onPick, onClose }: Props) {
  const [index, setIndex] = useState(0);

  const matches = useMemo(() => {
    const scored = notes
      .map((n) => ({ n, score: fuzzyMatch(filter, n.name + " " + n.path) }))
      .filter((s) => s.score > -1)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8);
    return scored.map((s) => s.n);
  }, [notes, filter]);

  useEffect(() => setIndex(0), [filter]);

  // Keyboard events forwarded from the editor (which owns real focus).
  useEffect(() => {
    const onKey = (e: Event) => {
      const key = (e as CustomEvent<string>).detail;
      if (key === "ArrowDown") setIndex((i) => Math.min(i + 1, matches.length - 1));
      else if (key === "ArrowUp") setIndex((i) => Math.max(i - 1, 0));
      else if (key === "Enter" || key === "Tab") {
        if (matches.length > 0) onPick(matches[Math.min(index, matches.length - 1)]);
        else onClose();
      } else if (key === "Escape") onClose();
    };
    window.addEventListener("wiki-picker-key", onKey);
    return () => window.removeEventListener("wiki-picker-key", onKey);
  }, [matches, index, onPick, onClose]);

  // Keep the popup on screen.
  const style: React.CSSProperties = {
    left: Math.min(x, window.innerWidth - 340),
    top: Math.min(y, window.innerHeight - 260),
  };

  return (
    <div className="wiki-picker" style={style}>
      <div className="wiki-picker-head">Link to note</div>
      {matches.length === 0 && <div className="wiki-picker-empty">No matches</div>}
      {matches.map((n, i) => (
        <div
          key={n.path}
          className={"wiki-picker-item" + (i === index ? " active" : "")}
          onMouseDown={(e) => {
            e.preventDefault(); // keep editor focus
            onPick(n);
          }}
          onMouseEnter={() => setIndex(i)}
        >
          <span className="wp-name">{n.name.replace(/\.[^.]+$/, "")}</span>
          <span className="wp-path">{n.path}</span>
        </div>
      ))}
    </div>
  );
}
