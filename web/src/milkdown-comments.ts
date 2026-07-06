import { $prose } from "@milkdown/kit/utils";
import { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet } from "@milkdown/kit/prose/view";
import type { Node as PMNode } from "@milkdown/kit/prose/model";
import type { Comment } from "./api";

export interface CommentHighlightState {
  comments: Comment[];
  activeId: string | null;
}

/**
 * Find a comment anchor in the doc by text search. Anchors are W3C-style
 * text quotes (quote + prefix/suffix context). Returns [from, to] in
 * ProseMirror positions, or null when the quoted text no longer exists.
 */
export function findAnchor(
  doc: PMNode,
  anchor: { quote: string; prefix: string; suffix: string }
): [number, number] | null {
  if (!anchor?.quote) return null;

  // Build a flat text of the doc with a map from text offsets -> PM positions.
  let text = "";
  const posMap: number[] = [];
  doc.descendants((node, pos) => {
    if (node.isText && node.text) {
      for (let i = 0; i < node.text.length; i++) posMap.push(pos + i);
      text += node.text;
    } else if (node.isBlock && text.length > 0 && !text.endsWith("\n")) {
      posMap.push(pos);
      text += "\n";
    }
    return true;
  });

  const { quote, prefix, suffix } = anchor;

  // Prefer a context-verified match, then fall back to the first quote hit.
  let best = -1;
  let idx = text.indexOf(quote);
  while (idx !== -1) {
    const before = text.slice(Math.max(0, idx - prefix.length), idx);
    const after = text.slice(idx + quote.length, idx + quote.length + suffix.length);
    const prefixOk = !prefix || before === prefix.slice(-before.length);
    const suffixOk = !suffix || after === suffix.slice(0, after.length);
    if (prefixOk && suffixOk) {
      best = idx;
      break;
    }
    if (best === -1) best = idx;
    idx = text.indexOf(quote, idx + 1);
  }
  if (best === -1) return null;

  const from = posMap[best];
  const last = posMap[Math.min(best + quote.length - 1, posMap.length - 1)];
  if (from == null || last == null) return null;
  return [from, last + 1];
}

/**
 * ProseMirror decoration plugin that highlights commented passages.
 * Reads open comments from a mutable state object owned by React (so React
 * updates don't require rebuilding the editor); call `refresh()` after
 * mutating it to repaint.
 */
export const commentHighlightKey = new PluginKey("comment-highlights");

export function commentHighlightPlugin(state: CommentHighlightState) {
  const key = commentHighlightKey;

  const build = (doc: PMNode) => {
    const decorations: Decoration[] = [];
    for (const c of state.comments) {
      if (c.status !== "open" || !c.anchor) continue;
      const range = findAnchor(doc, c.anchor);
      if (!range) continue;
      decorations.push(
        Decoration.inline(range[0], range[1], {
          class:
            "comment-hl" +
            (c.for === "agent" ? " agent" : "") +
            (c.id === state.activeId ? " active" : ""),
          "data-comment-id": c.id,
        })
      );
    }
    return DecorationSet.create(doc, decorations);
  };

  return $prose(
    () =>
      new Plugin({
        key,
        state: {
          init: (_, { doc }) => build(doc),
          apply: (tr, old) => {
            // Repaint on doc changes or when React pokes us via meta.
            if (tr.docChanged || tr.getMeta(key)) return build(tr.doc);
            return old;
          },
        },
        props: {
          decorations(s) {
            return key.getState(s);
          },
          handleClickOn(view, _pos, _node, _nodePos, event) {
            const el = (event.target as HTMLElement).closest?.("[data-comment-id]");
            if (el) {
              const id = el.getAttribute("data-comment-id")!;
              window.dispatchEvent(
                new CustomEvent("comment-highlight-click", { detail: id })
              );
              return false; // don't block normal cursor placement
            }
            return false;
          },
        },
      })
  );
}

