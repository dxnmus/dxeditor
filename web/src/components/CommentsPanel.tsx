import { useState } from "react";
import type { Comment } from "../api";
import Icon from "./Icon";

interface Props {
  comments: Comment[];
  activeId: string | null;
  anchorsFound: Record<string, boolean>;
  onFocus: (id: string | null) => void;
  onReply: (id: string, text: string) => void;
  onSetStatus: (id: string, status: "open" | "resolved") => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}

/** Right-hand review panel: comment threads for the open note. */
export default function CommentsPanel({
  comments,
  activeId,
  anchorsFound,
  onFocus,
  onReply,
  onSetStatus,
  onDelete,
  onClose,
}: Props) {
  const [filter, setFilter] = useState<"open" | "all">("open");
  const shown = comments.filter((c) => filter === "all" || c.status === "open");
  const openCount = comments.filter((c) => c.status === "open").length;

  return (
    <aside className="comments-panel">
      <div className="cp-head">
        <span className="cp-title">Comments</span>
        <div className="cp-filter">
          <button
            className={filter === "open" ? "on" : ""}
            onClick={() => setFilter("open")}
          >
            Open ({openCount})
          </button>
          <button
            className={filter === "all" ? "on" : ""}
            onClick={() => setFilter("all")}
          >
            All ({comments.length})
          </button>
        </div>
        <button className="ghost icon-btn cp-close" title="Close panel" onClick={onClose}>
          <Icon name="x" size={15} />
        </button>
      </div>

      <div className="cp-list">
        {shown.length === 0 && (
          <div className="cp-empty">
            {filter === "open"
              ? "No open comments. Select text in the note to add one."
              : "No comments yet. Select text in the note to add one."}
          </div>
        )}
        {shown.map((c) => (
          <CommentCard
            key={c.id}
            comment={c}
            active={c.id === activeId}
            anchorFound={anchorsFound[c.id] !== false}
            onFocus={onFocus}
            onReply={onReply}
            onSetStatus={onSetStatus}
            onDelete={onDelete}
          />
        ))}
      </div>
    </aside>
  );
}

function timeAgo(iso: string): string {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function CommentCard({
  comment: c,
  active,
  anchorFound,
  onFocus,
  onReply,
  onSetStatus,
  onDelete,
}: {
  comment: Comment;
  active: boolean;
  anchorFound: boolean;
  onFocus: (id: string | null) => void;
  onReply: (id: string, text: string) => void;
  onSetStatus: (id: string, status: "open" | "resolved") => void;
  onDelete: (id: string) => void;
}) {
  const [replying, setReplying] = useState(false);
  const [replyText, setReplyText] = useState("");

  function submitReply() {
    const t = replyText.trim();
    if (t) onReply(c.id, t);
    setReplyText("");
    setReplying(false);
  }

  return (
    <div
      id={`comment-${c.id}`}
      className={
        "comment-card" +
        (active ? " active" : "") +
        (c.status === "resolved" ? " resolved" : "")
      }
      onClick={() => onFocus(c.id)}
    >
      <div className="cc-top">
        <span className={"cc-chip " + c.for}>
          <Icon name={c.for === "agent" ? "bot" : "users"} size={13} />
          {c.for === "agent" ? "For agent" : "For team"}
        </span>
        {c.status === "resolved" && (
          <span className="cc-resolved"><Icon name="check" size={13} /> Resolved</span>
        )}
      </div>

      {c.anchor?.quote && (
        <div className="cc-quote" title={c.anchor.quote}>
          {anchorFound ? (
            c.anchor.quote
          ) : (
            <>
              <span className="cc-quote-missing">original text not found:</span>{" "}
              {c.anchor.quote}
            </>
          )}
        </div>
      )}

      <div className="cc-meta">
        <strong>{c.author}</strong> · {timeAgo(c.createdAt)}
      </div>
      <div className="cc-text">{c.text}</div>

      {c.replies?.length > 0 && (
        <div className="cc-replies">
          {c.replies.map((r, i) => (
            <div className="cc-reply" key={i}>
              <div className="cc-meta">
                <strong>
                  {r.author === "agent" ? (
                    <><Icon name="bot" size={12} /> agent</>
                  ) : (
                    r.author
                  )}
                </strong>{" "}
                · {timeAgo(r.createdAt)}
              </div>
              <div className="cc-text">{r.text}</div>
            </div>
          ))}
        </div>
      )}

      {replying ? (
        <div className="cc-replybox" onClick={(e) => e.stopPropagation()}>
          <textarea
            autoFocus
            placeholder="Reply…"
            value={replyText}
            onChange={(e) => setReplyText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submitReply();
              if (e.key === "Escape") setReplying(false);
            }}
          />
          <div className="cc-actions">
            <button className="btn" onClick={() => setReplying(false)}>
              Cancel
            </button>
            <button className="btn primary" onClick={submitReply}>
              Reply
            </button>
          </div>
        </div>
      ) : (
        <div className="cc-actions" onClick={(e) => e.stopPropagation()}>
          <button className="ghost" onClick={() => setReplying(true)}>
            Reply
          </button>
          {c.status === "open" ? (
            <button className="ghost" onClick={() => onSetStatus(c.id, "resolved")}>
              Resolve
            </button>
          ) : (
            <button className="ghost" onClick={() => onSetStatus(c.id, "open")}>
              Reopen
            </button>
          )}
          <button className="ghost danger" onClick={() => onDelete(c.id)}>
            Delete
          </button>
        </div>
      )}
    </div>
  );
}
