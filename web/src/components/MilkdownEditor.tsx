import { useEffect, useRef, useState } from "react";
import { Crepe } from "@milkdown/crepe";
import { editorViewCtx } from "@milkdown/kit/core";
import type { NoteRef, Comment, CommentAnchor } from "../api";
import {
  commentHighlightPlugin,
  commentHighlightKey,
  findAnchor,
  type CommentHighlightState,
} from "../milkdown-comments";
import WikiPicker from "./WikiPicker";
import Icon from "./Icon";

export interface SelectionForComment {
  anchor: CommentAnchor;
  x: number;
  y: number;
}

interface Props {
  /** Recreate the editor when this changes (parent should also key by it). */
  path: string;
  initialBody: string;
  notes: NoteRef[];
  comments: Comment[];
  activeCommentId: string | null;
  onChange: (markdown: string) => void;
  /** Called with the raw href of a clicked internal note link. */
  onOpenNote: (href: string) => void;
  /** User clicked the 💬 pill on a selection. */
  onSelectForComment: (sel: SelectionForComment) => void;
  /** User clicked a comment highlight in the text. */
  onCommentClick: (id: string) => void;
  /** Report which comment anchors were found in the doc. */
  onAnchorsComputed: (found: Record<string, boolean>) => void;
}

interface PickerState {
  open: boolean;
  x: number;
  y: number;
  filter: string;
  anchorPos: number; // ProseMirror position right after the "[["
}

interface PillState {
  visible: boolean;
  x: number;
  y: number;
  from: number;
  to: number;
}

const CLOSED: PickerState = { open: false, x: 0, y: 0, filter: "", anchorPos: 0 };

export default function MilkdownEditor({
  path,
  initialBody,
  notes,
  comments,
  activeCommentId,
  onChange,
  onOpenNote,
  onSelectForComment,
  onCommentClick,
  onAnchorsComputed,
}: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const crepeRef = useRef<Crepe | null>(null);
  const [picker, setPicker] = useState<PickerState>(CLOSED);
  const [pill, setPill] = useState<PillState>({
    visible: false,
    x: 0,
    y: 0,
    from: 0,
    to: 0,
  });
  const pickerRef = useRef(picker);
  pickerRef.current = picker;
  const pillRef = useRef(pill);
  pillRef.current = pill;

  // Mutable state the decoration plugin reads (survives without re-creating
  // the editor); poked via a meta transaction when comments change.
  const hlState = useRef<CommentHighlightState>({ comments: [], activeId: null });

  // Keep latest callbacks without re-creating the editor.
  const cb = useRef({ onChange, onOpenNote, onSelectForComment, onCommentClick, onAnchorsComputed });
  cb.current = { onChange, onOpenNote, onSelectForComment, onCommentClick, onAnchorsComputed };

  // Crepe normalizes markdown on load (e.g. "-" bullets become "*") and fires
  // update events for it — sometimes well after create() resolves. Only accept
  // updates once the user has actually interacted with the editor, so merely
  // OPENING a note never rewrites it on disk (that would spam OneDrive sync).
  const interactedRef = useRef(false);

  useEffect(() => {
    if (!rootRef.current) return;
    let destroyed = false;
    interactedRef.current = false;

    const crepe = new Crepe({
      root: rootRef.current,
      defaultValue: initialBody,
      features: {
        [Crepe.Feature.Latex]: false,
      },
      featureConfigs: {
        [Crepe.Feature.Placeholder]: {
          text: "Write something, or press '/' for blocks…",
        },
      },
    });

    crepe.editor.use(commentHighlightPlugin(hlState.current));

    crepe.on((listener) => {
      listener.markdownUpdated((_ctx, md, prevMd) => {
        if (interactedRef.current && md !== prevMd) cb.current.onChange(md);
      });
    });

    crepe.create().then(() => {
      if (destroyed) crepe.destroy();
    });
    crepeRef.current = crepe;

    return () => {
      destroyed = true;
      try {
        crepe.destroy();
      } catch {
        /* destroy during pending create can throw; safe to ignore */
      }
      crepeRef.current = null;
      setPicker(CLOSED);
    };
    // Recreated per file open; parent keys this component by path.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  // ---- Comment highlights: sync props -> plugin state -------------------------
  useEffect(() => {
    hlState.current.comments = comments;
    hlState.current.activeId = activeCommentId;
    const crepe = crepeRef.current;
    if (!crepe) return;
    try {
      crepe.editor.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        // Poke the plugin to rebuild decorations.
        view.dispatch(view.state.tr.setMeta(commentHighlightKey, true));
        // Report which anchors still resolve, for the panel's
        // "original text not found" state.
        const found: Record<string, boolean> = {};
        for (const c of comments) {
          if (c.anchor?.quote) {
            found[c.id] = findAnchor(view.state.doc, c.anchor) != null;
          }
        }
        cb.current.onAnchorsComputed(found);
      });
    } catch {
      /* editor still booting */
    }
  }, [comments, activeCommentId, path]);

  // Highlight clicks arrive via a window event from the PM plugin.
  useEffect(() => {
    const onHl = (e: Event) => {
      cb.current.onCommentClick((e as CustomEvent<string>).detail);
    };
    window.addEventListener("comment-highlight-click", onHl);
    return () => window.removeEventListener("comment-highlight-click", onHl);
  }, []);

  // ---- Selection pill (💬 Comment) ---------------------------------------------
  function syncSelectionPill() {
    const crepe = crepeRef.current;
    if (!crepe) return;
    try {
      crepe.editor.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        const { from, to, empty } = view.state.selection;
        if (empty || to - from < 2) {
          setPill((p) => (p.visible ? { ...p, visible: false } : p));
          return;
        }
        const coords = view.coordsAtPos(to);
        // Remember the exact range now — the DOM selection is often gone by the
        // time the pill is clicked, so we must not re-read it later.
        setPill({ visible: true, x: coords.left + 8, y: coords.bottom + 6, from, to });
      });
    } catch {
      /* ignore */
    }
  }

  function openCommentPopover() {
    const crepe = crepeRef.current;
    if (!crepe) return;
    const p = pillRef.current;
    crepe.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const doc = view.state.doc;
      // Use the range captured when the pill appeared, not the live selection.
      const from = Math.min(p.from, doc.content.size);
      const to = Math.min(p.to, doc.content.size);
      if (to <= from) return;
      const quote = doc.textBetween(from, to, "\n");
      if (!quote.trim()) return;
      const anchor: CommentAnchor = {
        quote,
        prefix: doc.textBetween(Math.max(0, from - 32), from, "\n"),
        suffix: doc.textBetween(to, Math.min(doc.content.size, to + 32), "\n"),
      };
      const coords = view.coordsAtPos(to);
      setPill({ visible: false, x: 0, y: 0, from: 0, to: 0 });
      cb.current.onSelectForComment({
        anchor,
        x: coords.left,
        y: coords.bottom + 8,
      });
    });
  }

  // ---- Wiki-link "[[" picker ------------------------------------------------

  /** Inspect the text before the caret to open/update/close the picker. */
  function syncPickerToCaret() {
    const crepe = crepeRef.current;
    if (!crepe) return;
    try {
      crepe.editor.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        const { state } = view;
        const from = state.selection.from;
        const p = pickerRef.current;

        if (!p.open) {
          // Did the user just finish typing "[[" ?
          const before = state.doc.textBetween(Math.max(0, from - 2), from);
          if (before === "[[") {
            const coords = view.coordsAtPos(from);
            setPicker({
              open: true,
              x: coords.left,
              y: coords.bottom + 4,
              filter: "",
              anchorPos: from,
            });
          }
          return;
        }

        // Picker is open: recompute the filter from anchor → caret.
        if (from < p.anchorPos) {
          setPicker(CLOSED);
          return;
        }
        const typed = state.doc.textBetween(p.anchorPos, from);
        if (typed.includes("]") || typed.includes("\n") || typed.length > 60) {
          setPicker(CLOSED);
          return;
        }
        // Confirm the "[[" is still there (undo may have removed it).
        const fence = state.doc.textBetween(
          Math.max(0, p.anchorPos - 2),
          p.anchorPos
        );
        if (fence !== "[[") {
          setPicker(CLOSED);
          return;
        }
        setPicker({ ...p, filter: typed });
      });
    } catch (err) {
      console.error("[wiki-picker]", err);
      setPicker(CLOSED);
    }
  }

  /** Compute an href from the current file's folder to the target note. */
  function relativeHref(targetPath: string): string {
    const fromParts = path.split("/").slice(0, -1); // current file's dir
    const toParts = targetPath.split("/");
    while (
      fromParts.length &&
      toParts.length > 1 &&
      fromParts[0] === toParts[0]
    ) {
      fromParts.shift();
      toParts.shift();
    }
    return [...fromParts.map(() => ".."), ...toParts].join("/");
  }

  function insertLink(note: NoteRef) {
    const crepe = crepeRef.current;
    const p = pickerRef.current;
    if (!crepe || !p.open) return;
    crepe.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const { state } = view;
      const from = state.selection.from;
      const start = p.anchorPos - 2; // include the "[["
      const label = note.name.replace(/\.(md|markdown|mdown|txt)$/i, "");
      const linkMark = state.schema.marks.link.create({
        href: encodeURI(relativeHref(note.path)),
      });
      const node = state.schema.text(label, [linkMark]);
      view.dispatch(state.tr.replaceWith(start, from, node));
      view.focus();
    });
    setPicker(CLOSED);
  }

  // Watch typing/caret movement while mounted.
  function handleKeyUp(e: React.KeyboardEvent) {
    // Navigation keys are handled in keydown; don't fight them here.
    if (["ArrowUp", "ArrowDown", "Enter", "Escape"].includes(e.key)) return;
    syncPickerToCaret();
    syncSelectionPill();
  }

  function handleKeyDownCapture(e: React.KeyboardEvent) {
    if (!pickerRef.current.open) return;
    // Let WikiPicker consume navigation keys.
    if (["ArrowUp", "ArrowDown", "Enter", "Escape", "Tab"].includes(e.key)) {
      e.preventDefault();
      e.stopPropagation();
      window.dispatchEvent(
        new CustomEvent("wiki-picker-key", { detail: e.key })
      );
    }
  }

  // ---- Internal link navigation ----------------------------------------------

  function handleClickCapture(e: React.MouseEvent) {
    const anchor = (e.target as HTMLElement).closest("a");
    if (!anchor) {
      if (pickerRef.current.open) setPicker(CLOSED);
      return;
    }
    const href = anchor.getAttribute("href") || "";
    if (/^(https?:|mailto:|tel:)/i.test(href)) return; // external: leave to Crepe
    if (/\.(md|markdown|mdown|txt)$/i.test(href)) {
      e.preventDefault();
      e.stopPropagation();
      cb.current.onOpenNote(decodeURI(href));
    }
  }

  const markInteracted = () => {
    interactedRef.current = true;
  };

  return (
    <div
      className="editor-host"
      onKeyUp={handleKeyUp}
      onKeyDownCapture={(e) => {
        markInteracted();
        handleKeyDownCapture(e);
      }}
      onMouseDownCapture={markInteracted}
      onPasteCapture={markInteracted}
      onDropCapture={markInteracted}
      onMouseUp={() => setTimeout(syncSelectionPill, 10)}
      onClickCapture={handleClickCapture}
    >
      <div ref={rootRef} className="crepe-root" />
      {pill.visible && (
        <button
          className="comment-pill"
          style={{ left: pill.x, top: pill.y }}
          onMouseDown={(e) => {
            e.preventDefault(); // keep the text selection
            openCommentPopover();
          }}
        >
          <Icon name="message" size={14} /> Comment
        </button>
      )}
      {picker.open && (
        <WikiPicker
          x={picker.x}
          y={picker.y}
          filter={picker.filter}
          notes={notes}
          onPick={insertLink}
          onClose={() => setPicker(CLOSED)}
        />
      )}
    </div>
  );
}
