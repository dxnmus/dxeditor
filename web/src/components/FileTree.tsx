import { useEffect, useRef, useState } from "react";
import type { TreeNode } from "../api";
import Icon, { type IconName } from "./Icon";

interface Props {
  nodes: TreeNode[];
  activePath: string | null;
  renamingPath: string | null;
  onOpen: (path: string) => void;
  onMenu: (e: React.MouseEvent, node: TreeNode) => void;
  onRenameSubmit: (node: TreeNode, newName: string) => void;
  onRenameCancel: () => void;
}

export default function FileTree(props: Props) {
  return (
    <ul className="tree">
      {props.nodes.map((node) => (
        <TreeItem key={node.path} node={node} depth={0} {...props} />
      ))}
    </ul>
  );
}

function TreeItem({
  node,
  depth,
  ...props
}: Props & { node: TreeNode; depth: number }) {
  const [open, setOpen] = useState(depth < 1);
  const isRenaming = props.renamingPath === node.path;
  const pad = { paddingLeft: 10 + depth * 16 };

  // Auto-expand a folder that contains the active file.
  useEffect(() => {
    if (
      node.type === "dir" &&
      props.activePath &&
      props.activePath.startsWith(node.path + "/")
    ) {
      setOpen(true);
    }
  }, [props.activePath, node]);

  const readOnly = node.type === "file" && node.editable === false;
  const label = isRenaming ? (
    <RenameInput
      initial={node.name}
      onSubmit={(v) => props.onRenameSubmit(node, v)}
      onCancel={props.onRenameCancel}
    />
  ) : (
    <span className="label">
      {node.type === "file" && !readOnly
        ? node.name.replace(/\.(md|markdown|mdown)$/i, "")
        : node.name}
    </span>
  );

  const fileIcon: IconName = readOnly ? iconFor(node.name) : "file";

  if (node.type === "dir") {
    return (
      <li>
        <div
          className="row dir"
          style={pad}
          onClick={() => !isRenaming && setOpen((o) => !o)}
          onContextMenu={(e) => props.onMenu(e, node)}
        >
          <span className="chevron">
            <Icon name={open ? "chevron-down" : "chevron-right"} size={13} />
          </span>
          <span className="file-icon">
            <Icon name="folder" size={15} />
          </span>
          {label}
          <button
            className="row-action icon-btn"
            title="Options"
            onClick={(e) => {
              e.stopPropagation();
              props.onMenu(e, node);
            }}
          >
            ⋯
          </button>
        </div>
        {open && node.children.length > 0 && (
          <ul>
            {node.children.map((child) => (
              <TreeItem key={child.path} node={child} depth={depth + 1} {...props} />
            ))}
          </ul>
        )}
      </li>
    );
  }

  return (
    <li>
      <div
        className={
          "row file" +
          (props.activePath === node.path ? " active" : "") +
          (readOnly ? " readonly" : "")
        }
        style={pad}
        onClick={() => !isRenaming && props.onOpen(node.path)}
        onContextMenu={(e) => props.onMenu(e, node)}
      >
        <span className="chevron" />
        <span className="file-icon">
          <Icon name={fileIcon} size={15} />
        </span>
        {label}
        <button
          className="row-action icon-btn"
          title="Options"
          onClick={(e) => {
            e.stopPropagation();
            props.onMenu(e, node);
          }}
        >
          ⋯
        </button>
      </div>
    </li>
  );
}

/** A line icon for read-only, non-markdown files, chosen by extension. */
function iconFor(name: string): IconName {
  const ext = name.slice(name.lastIndexOf(".")).toLowerCase();
  if (/\.(png|jpg|jpeg|gif|webp|svg|bmp|ico)$/.test(ext)) return "image";
  if (/\.(pdf|docx?|rtf|pages)$/.test(ext)) return "file-text";
  if (/\.(xlsx?|csv|numbers)$/.test(ext)) return "sheet";
  if (/\.(json|ya?ml|toml|xml)$/.test(ext)) return "code";
  if (/\.(zip|tar|gz|rar)$/.test(ext)) return "archive";
  return "paperclip";
}

function RenameInput({
  initial,
  onSubmit,
  onCancel,
}: {
  initial: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const input = ref.current;
    if (input) {
      input.focus();
      const dot = initial.lastIndexOf(".");
      input.setSelectionRange(0, dot > 0 ? dot : initial.length);
    }
  }, [initial]);

  return (
    <input
      ref={ref}
      className="rename-input"
      defaultValue={initial}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") {
          const v = (e.target as HTMLInputElement).value.trim();
          if (v && v !== initial) onSubmit(v);
          else onCancel();
        }
        if (e.key === "Escape") onCancel();
      }}
      onBlur={(e) => {
        const v = e.target.value.trim();
        if (v && v !== initial) onSubmit(v);
        else onCancel();
      }}
    />
  );
}
