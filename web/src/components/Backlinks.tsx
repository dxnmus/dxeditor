import { useState } from "react";
import type { Backlink } from "../api";
import Icon from "./Icon";

interface Props {
  backlinks: Backlink[];
  onOpen: (path: string) => void;
}

/** "Linked mentions" panel shown under the editor. */
export default function Backlinks({ backlinks, onOpen }: Props) {
  const [open, setOpen] = useState(true);
  if (backlinks.length === 0) return null;

  return (
    <div className="backlinks">
      <button className="backlinks-head" onClick={() => setOpen((o) => !o)}>
        <span className="chevron">
          <Icon name={open ? "chevron-down" : "chevron-right"} size={13} />
        </span>
        Linked mentions ({backlinks.length})
      </button>
      {open && (
        <div className="backlinks-list">
          {backlinks.map((b) => (
            <div className="backlink" key={b.path} onClick={() => onOpen(b.path)}>
              <div className="bl-name">
                <Icon name="file" size={14} /> {b.name.replace(/\.[^.]+$/, "")}
              </div>
              <div className="bl-snippet">{b.snippet}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
