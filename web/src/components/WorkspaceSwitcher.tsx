import { useEffect, useRef, useState } from "react";
import type { Workspace } from "../api";
import Icon from "./Icon";

interface Props {
  workspaces: Workspace[];
  activeId: string;
  onSwitch: (id: string) => void;
  onAdd: () => void;
  onRename: (ws: Workspace) => void;
  onRemove: (ws: Workspace) => void;
  onInstallAgents: (ws: Workspace) => void;
}

/** Notion-style workspace dropdown at the top of the sidebar. */
export default function WorkspaceSwitcher({
  workspaces,
  activeId,
  onSwitch,
  onAdd,
  onRename,
  onRemove,
  onInstallAgents,
}: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const active = workspaces.find((w) => w.id === activeId) ?? workspaces[0];

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);

  return (
    <div className="ws-switcher" ref={ref}>
      <div className="ws-caption">Workspace</div>
      <button
        className="ws-current"
        data-open={open}
        title="Switch workspace"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="ws-icon"><Icon name="workspace" size={15} /></span>
        <span className="ws-name">{active?.name ?? "…"}</span>
        <span className="ws-chevron"><Icon name="chevron-down" size={14} /></span>
      </button>

      {open && (
        <div className="ws-menu">
          <div className="ws-menu-label">Workspaces</div>
          {workspaces.map((w) => (
            <div
              key={w.id}
              className={"ws-item" + (w.id === active?.id ? " active" : "")}
              onClick={() => {
                setOpen(false);
                onSwitch(w.id);
              }}
            >
              <span className="ws-item-name">{w.name}</span>
              <span className="ws-item-root" title={w.root}>
                {w.root}
              </span>
              <span className="ws-item-actions">
                <button
                  className="icon-btn"
                  title="Rename"
                  onClick={(e) => {
                    e.stopPropagation();
                    setOpen(false);
                    onRename(w);
                  }}
                >
                  <Icon name="pencil" size={14} />
                </button>
                <button
                  className="icon-btn"
                  title="Add agent instructions (AGENTS.md)"
                  onClick={(e) => {
                    e.stopPropagation();
                    setOpen(false);
                    onInstallAgents(w);
                  }}
                >
                  <Icon name="bot" size={14} />
                </button>
                {workspaces.length > 1 && (
                  <button
                    className="icon-btn"
                    title="Remove from list (folder is not deleted)"
                    onClick={(e) => {
                      e.stopPropagation();
                      setOpen(false);
                      onRemove(w);
                    }}
                  >
                    <Icon name="x" size={14} />
                  </button>
                )}
              </span>
            </div>
          ))}
          <div className="ws-menu-divider" />
          <div
            className="ws-item ws-add"
            onClick={() => {
              setOpen(false);
              onAdd();
            }}
          >
            <Icon name="plus" size={15} /> Add workspace…
          </div>
        </div>
      )}
    </div>
  );
}
