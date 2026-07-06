import { useEffect, useRef, useState } from "react";
import Icon from "./Icon";

interface Props {
  x: number;
  y: number;
  quote: string;
  onSubmit: (text: string, audience: "agent" | "team") => void;
  onCancel: () => void;
}

/** Popover for writing a new comment on selected text. */
export default function CommentPopover({ x, y, quote, onSubmit, onCancel }: Props) {
  const [text, setText] = useState("");
  const [audience, setAudience] = useState<"agent" | "team">("agent");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onCancel();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [onCancel]);

  function submit() {
    const t = text.trim();
    if (t) onSubmit(t, audience);
  }

  const style: React.CSSProperties = {
    left: Math.min(x, window.innerWidth - 380),
    top: Math.min(y, window.innerHeight - 260),
  };

  return (
    <div ref={ref} className="comment-popover" style={style}>
      <div className="cpop-quote">“{quote.length > 120 ? quote.slice(0, 120) + "…" : quote}”</div>
      <div className="cpop-audience">
        <button
          className={audience === "agent" ? "on" : ""}
          onClick={() => setAudience("agent")}
          title="The AI agent in the pipeline will act on this"
        >
          <Icon name="bot" size={14} /> For agent
        </button>
        <button
          className={audience === "team" ? "on" : ""}
          onClick={() => setAudience("team")}
          title="For a colleague to read"
        >
          <Icon name="users" size={14} /> For team
        </button>
      </div>
      <textarea
        autoFocus
        placeholder={
          audience === "agent"
            ? "Tell the agent what to change…"
            : "Write a comment for the team…"
        }
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
        }}
      />
      <div className="cpop-actions">
        <span className="cpop-hint">⌘↵ to submit</span>
        <button className="btn" onClick={onCancel}>
          Cancel
        </button>
        <button className="btn primary" onClick={submit} disabled={!text.trim()}>
          Comment
        </button>
      </div>
    </div>
  );
}
