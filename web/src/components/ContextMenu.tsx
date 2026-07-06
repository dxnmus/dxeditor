import { useEffect, useRef, type ReactNode } from "react";

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  danger?: boolean;
  divider?: boolean;
  onSelect?: () => void;
}

interface Props {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
}

/** Right-click context menu. Rendered at a fixed position, closes on any click/escape. */
export default function ContextMenu({ x, y, items, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = () => onClose();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    // Delay so the opening right-click doesn't instantly close it.
    const t = setTimeout(() => {
      window.addEventListener("mousedown", close);
      window.addEventListener("blur", close);
    }, 0);
    window.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(t);
      window.removeEventListener("mousedown", close);
      window.removeEventListener("blur", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  // Keep on screen.
  const style: React.CSSProperties = {
    left: Math.min(x, window.innerWidth - 220),
    top: Math.min(y, window.innerHeight - items.length * 34 - 16),
  };

  return (
    <div ref={ref} className="context-menu" style={style}>
      {items.map((item, i) =>
        item.divider ? (
          <div key={i} className="cm-divider" />
        ) : (
          <div
            key={i}
            className={"cm-item" + (item.danger ? " danger" : "")}
            onMouseDown={(e) => {
              e.stopPropagation();
              onClose();
              item.onSelect?.();
            }}
          >
            {item.icon && <span className="cm-icon">{item.icon}</span>}
            {item.label}
          </div>
        )
      )}
    </div>
  );
}
