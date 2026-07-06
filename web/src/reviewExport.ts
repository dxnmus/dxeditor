// Builds a self-contained "review copy" HTML file for stakeholders who do not
// have DXEditor. They open it in any browser, read the draft, leave anchored
// comments, and record an Approve / Request-changes decision. On finish they
// download a feedback file (`<draft>.review.json`) that the sender imports back
// into DXEditor, where it merges into the draft's comments sidecar.
//
// Everything is inlined (CSS + JS + content) so the file works offline with no
// server and no dependencies.

export interface ReviewData {
  title: string;
  contentHtml: string; // already-sanitized rendered draft HTML
  draftFile: string; // note basename, e.g. "career-paths.md"
}

// Attributes we keep when sanitizing the live editor DOM into portable HTML.
const ALLOWED_ATTRS = new Set([
  "href",
  "src",
  "alt",
  "title",
  "colspan",
  "rowspan",
  "start",
  "type",
  "checked",
  "lang",
  "align",
]);

/** Clone the rendered editor DOM and strip editor-only attributes/classes. */
export function sanitizeRenderedHtml(source: Element): string {
  const clone = source.cloneNode(true) as Element;
  const walk = (el: Element) => {
    for (const attr of Array.from(el.attributes)) {
      if (!ALLOWED_ATTRS.has(attr.name.toLowerCase())) el.removeAttribute(attr.name);
    }
    for (const child of Array.from(el.children)) walk(child as Element);
  };
  walk(clone);
  return clone.innerHTML;
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Vanilla runtime embedded in the exported file. Uses only DOM + globals. */
function reviewRuntime() {
  const RV: { draft: string } = (window as any).RV_CONFIG;
  const docEl = document.getElementById("rv-doc") as HTMLElement;
  const listEl = document.getElementById("rv-list") as HTMLElement;
  const countEl = document.getElementById("rv-count") as HTMLElement;
  const pill = document.getElementById("rv-pill") as HTMLButtonElement;
  const nameEl = document.getElementById("rv-name") as HTMLInputElement;
  const toast = document.getElementById("rv-toast") as HTMLElement;

  interface RComment {
    id: number;
    quote: string;
    prefix: string;
    suffix: string;
    text: string;
  }
  const comments: RComment[] = [];
  let seq = 0;
  let pending: { quote: string; prefix: string; suffix: string } | null = null;

  function showToast(msg: string) {
    toast.textContent = msg;
    toast.hidden = false;
    setTimeout(() => (toast.hidden = true), 2600);
  }

  // Flat-text offset of a point inside the document (matches DXEditor anchoring).
  function offsetOf(node: Node, off: number): number {
    const r = document.createRange();
    r.setStart(docEl, 0);
    r.setEnd(node, off);
    return r.toString().length;
  }

  function hidePill() {
    pill.hidden = true;
    pending = null;
  }

  document.addEventListener("mouseup", () => {
    setTimeout(() => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
        if (pill.hidden) return;
        // keep pill if the click was on it
        return;
      }
      const range = sel.getRangeAt(0);
      if (!docEl.contains(range.commonAncestorContainer)) {
        hidePill();
        return;
      }
      const quote = sel.toString();
      if (quote.trim().length < 2) {
        hidePill();
        return;
      }
      const full = docEl.textContent || "";
      const start = offsetOf(range.startContainer, range.startOffset);
      const end = offsetOf(range.endContainer, range.endOffset);
      pending = {
        quote,
        prefix: full.slice(Math.max(0, start - 32), start),
        suffix: full.slice(end, end + 32),
      };
      const rect = range.getBoundingClientRect();
      pill.style.left = rect.left + window.scrollX + rect.width / 2 - 40 + "px";
      pill.style.top = rect.bottom + window.scrollY + 8 + "px";
      pill.hidden = false;
    }, 10);
  });

  pill.addEventListener("mousedown", (e) => {
    e.preventDefault();
    if (!pending) return;
    const text = window.prompt("Your comment on:\n\n“" + pending.quote.slice(0, 140) + "”");
    if (text && text.trim()) {
      comments.push({ id: ++seq, ...pending, text: text.trim() });
      render();
      showToast("Comment added");
    }
    hidePill();
    const s = window.getSelection();
    if (s) s.removeAllRanges();
  });

  function render() {
    countEl.textContent = String(comments.length);
    if (comments.length === 0) {
      listEl.innerHTML =
        '<div class="rv-empty">Select text in the draft to add a comment.</div>';
      return;
    }
    listEl.innerHTML = "";
    comments.forEach((c) => {
      const card = document.createElement("div");
      card.className = "rv-card";
      const q = document.createElement("div");
      q.className = "rv-quote";
      q.textContent = c.quote.length > 90 ? c.quote.slice(0, 90) + "…" : c.quote;
      const t = document.createElement("div");
      t.className = "rv-text";
      t.textContent = c.text;
      const del = document.createElement("button");
      del.className = "rv-del";
      del.textContent = "Remove";
      del.onclick = () => {
        const i = comments.findIndex((x) => x.id === c.id);
        if (i >= 0) comments.splice(i, 1);
        render();
      };
      card.appendChild(q);
      card.appendChild(t);
      card.appendChild(del);
      listEl.appendChild(card);
    });
  }

  function decision(): string {
    const el = document.querySelector(
      'input[name="rv-decision"]:checked'
    ) as HTMLInputElement | null;
    return el ? el.value : "none";
  }

  function buildFeedback() {
    return {
      version: 1,
      source: "dxeditor-review",
      draft: RV.draft,
      reviewer: nameEl.value.trim() || "Reviewer",
      decision: decision(),
      reviewedAt: new Date().toISOString(),
      comments: comments.map((c) => ({
        text: c.text,
        anchor: { quote: c.quote, prefix: c.prefix, suffix: c.suffix },
      })),
    };
  }

  (document.getElementById("rv-download") as HTMLButtonElement).onclick = () => {
    if (decision() === "none" && comments.length === 0) {
      showToast("Add a comment or choose a decision first");
      return;
    }
    const data = buildFeedback();
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = RV.draft.replace(/\.[^.]+$/, "") + ".review.json";
    a.click();
    URL.revokeObjectURL(url);
    showToast("Feedback downloaded — send it back to the sender");
  };

  (document.getElementById("rv-copy") as HTMLButtonElement).onclick = () => {
    const d = buildFeedback();
    const lines: string[] = [];
    lines.push("Review of: " + d.draft);
    lines.push("Reviewer: " + d.reviewer);
    lines.push(
      "Decision: " +
        (d.decision === "approved"
          ? "Approved"
          : d.decision === "changes"
          ? "Requested changes"
          : "No decision")
    );
    lines.push("");
    d.comments.forEach((c, i) => {
      lines.push(i + 1 + '. On "' + c.anchor.quote.slice(0, 80) + '":');
      lines.push("   " + c.text);
    });
    const text = lines.join("\n");
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).then(
        () => showToast("Summary copied"),
        () => showToast("Copy failed")
      );
    }
  };

  render();
}

const REVIEW_CSS = `
* { box-sizing: border-box; }
body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, Helvetica, Arial, sans-serif; color: #37352f; background: #fafaf9; -webkit-font-smoothing: antialiased; }
.rv-top { position: sticky; top: 0; z-index: 5; display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 12px 22px; background: #fff; border-bottom: 1px solid rgba(0,0,0,0.09); flex-wrap: wrap; }
.rv-brand { font-weight: 700; font-size: 15px; letter-spacing: -0.01em; }
.rv-brand span { color: #9b9a97; font-weight: 600; margin-left: 4px; }
.rv-decision { display: flex; align-items: center; gap: 14px; font-size: 13.5px; }
.rv-decision-label { color: #787774; }
.rv-decision label { display: inline-flex; align-items: center; gap: 5px; cursor: pointer; }
.rv-wrap { display: flex; align-items: flex-start; gap: 24px; max-width: 1080px; margin: 0 auto; padding: 28px 22px 80px; }
.rv-doc { flex: 1; min-width: 0; }
.rv-name { width: 260px; max-width: 100%; padding: 7px 10px; margin-bottom: 20px; border: 1px solid rgba(0,0,0,0.12); border-radius: 7px; font-size: 13.5px; font-family: inherit; outline: none; }
.rv-name:focus { border-color: #2383e2; }
#rv-doc { font-size: 16px; line-height: 1.65; }
#rv-doc h1 { font-size: 30px; line-height: 1.2; margin: 0 0 18px; }
#rv-doc h2 { font-size: 22px; margin: 30px 0 8px; }
#rv-doc h3 { font-size: 18px; margin: 24px 0 6px; }
#rv-doc p { margin: 10px 0; }
#rv-doc ul, #rv-doc ol { padding-left: 24px; }
#rv-doc li { margin: 4px 0; }
#rv-doc a { color: #2383e2; }
#rv-doc blockquote { border-left: 3px solid rgba(0,0,0,0.15); margin: 14px 0; padding: 2px 0 2px 16px; color: #56544f; }
#rv-doc pre { background: #f4f4f2; border-radius: 8px; padding: 14px 16px; overflow-x: auto; font-size: 13.5px; }
#rv-doc code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 0.92em; }
#rv-doc img { max-width: 100%; height: auto; border-radius: 8px; }
#rv-doc table { border-collapse: collapse; width: 100%; }
#rv-doc th, #rv-doc td { border: 1px solid rgba(0,0,0,0.12); padding: 6px 10px; text-align: left; }
.rv-side { width: 300px; flex-shrink: 0; position: sticky; top: 74px; background: #fff; border: 1px solid rgba(0,0,0,0.09); border-radius: 12px; padding: 14px; }
.rv-side-head { font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; font-weight: 700; color: #9b9a97; margin-bottom: 10px; }
.rv-side-head span { color: #2383e2; }
.rv-list { max-height: 52vh; overflow-y: auto; margin-bottom: 12px; }
.rv-empty { font-size: 13px; color: #9b9a97; line-height: 1.6; padding: 8px 2px; }
.rv-card { border: 1px solid rgba(0,0,0,0.09); border-radius: 9px; padding: 9px 10px; margin-bottom: 8px; }
.rv-quote { font-size: 12px; color: #56544f; border-left: 2px solid #f5c518; padding-left: 8px; margin-bottom: 6px; }
.rv-text { font-size: 13.5px; line-height: 1.5; }
.rv-del { margin-top: 6px; border: none; background: transparent; color: #9b9a97; font-size: 11.5px; cursor: pointer; padding: 2px 0; }
.rv-del:hover { color: #eb5757; }
.rv-actions { display: flex; flex-direction: column; gap: 7px; }
.rv-btn { font-family: inherit; font-size: 13px; padding: 9px 12px; border-radius: 8px; border: 1px solid rgba(0,0,0,0.12); background: #fff; cursor: pointer; }
.rv-btn:hover { background: #f4f4f2; }
.rv-btn.primary { background: #2383e2; border-color: #2383e2; color: #fff; font-weight: 600; }
.rv-btn.primary:hover { background: #1a74cc; }
.rv-hint { font-size: 11.5px; color: #9b9a97; line-height: 1.5; margin-top: 10px; }
.rv-pill { position: absolute; z-index: 20; display: inline-flex; align-items: center; gap: 5px; border: none; background: #37352f; color: #fff; font-family: inherit; font-size: 12.5px; font-weight: 600; padding: 6px 12px; border-radius: 999px; cursor: pointer; box-shadow: 0 4px 14px rgba(0,0,0,0.25); }
.rv-toast { position: fixed; bottom: 22px; left: 50%; transform: translateX(-50%); background: #37352f; color: #fff; font-size: 13px; padding: 9px 16px; border-radius: 999px; z-index: 40; box-shadow: 0 6px 20px rgba(0,0,0,0.28); }
@media (max-width: 820px) { .rv-wrap { flex-direction: column; } .rv-side { width: 100%; position: static; } }
`;

export function buildReviewHtml(data: ReviewData): string {
  const runtime = `(${reviewRuntime.toString()})();`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(data.title)} — Review</title>
<style>${REVIEW_CSS}</style>
</head>
<body>
<header class="rv-top">
  <div class="rv-brand">DXEditor <span>Review</span></div>
  <div class="rv-decision">
    <span class="rv-decision-label">Your decision:</span>
    <label><input type="radio" name="rv-decision" value="approved" /> Approve</label>
    <label><input type="radio" name="rv-decision" value="changes" /> Request changes</label>
  </div>
</header>
<div class="rv-wrap">
  <main class="rv-doc">
    <input id="rv-name" placeholder="Your name (shown on your comments)" />
    <article id="rv-doc"><h1>${esc(data.title)}</h1>${data.contentHtml}</article>
  </main>
  <aside class="rv-side">
    <div class="rv-side-head">Comments <span id="rv-count">0</span></div>
    <div id="rv-list" class="rv-list"></div>
    <div class="rv-actions">
      <button id="rv-download" class="rv-btn primary">Finish review — download feedback</button>
      <button id="rv-copy" class="rv-btn">Copy summary as text</button>
    </div>
    <div class="rv-hint">Send the downloaded file back to whoever shared this. They import it into DXEditor and your comments land right on the draft.</div>
  </aside>
</div>
<button id="rv-pill" class="rv-pill" hidden>Comment</button>
<div id="rv-toast" class="rv-toast" hidden></div>
<script>window.RV_CONFIG = ${JSON.stringify({ draft: data.draftFile })};</script>
<script>${runtime}</script>
</body>
</html>`;
}
