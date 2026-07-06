# Agent instructions: review comments on notes in this folder

Humans review the markdown drafts in this folder with a visual editor and
leave comments. Comments are stored in a sidecar file next to each note:

```
my-post.md               <- the draft (keep this clean; no comment markup)
my-post.comments.json    <- comments about the draft
```

## Sidecar format

```json
{
  "version": 1,
  "comments": [
    {
      "id": "c-1736100000-ab12",
      "author": "Nelson",
      "for": "agent",
      "status": "open",
      "createdAt": "2026-07-05T21:00:00Z",
      "anchor": {
        "quote": "the exact text the comment refers to",
        "prefix": "up to 32 chars before it",
        "suffix": "up to 32 chars after it"
      },
      "text": "The instruction or feedback.",
      "replies": [
        { "author": "agent", "text": "What was changed.", "createdAt": "..." }
      ]
    }
  ]
}
```

- `for` is `"agent"` (addressed to you) or `"team"` (addressed to a person).
- `status` is `"open"` or `"resolved"`.
- `anchor.quote` locates the passage the comment is about. It may no longer
  appear verbatim if the draft has changed; use `prefix`/`suffix` and context
  to find the right spot.

## What you must do when working in this folder

1. Before editing any `.md` file, check for its `.comments.json` sidecar.
2. Process every comment with `"for": "agent"` and `"status": "open"`:
   - Find the passage via `anchor.quote` and apply the requested change to
     the `.md` file.
   - Set that comment's `status` to `"resolved"`.
   - Append a reply to its `replies` array:
     `{ "author": "agent", "text": "<one sentence: what you changed>", "createdAt": "<ISO timestamp>" }`
3. Comments with `"for": "team"` are for humans. Read them for context —
   they often explain intent — but do not resolve them and do not act on
   them unless a human asks you to.
4. Never delete comments, never remove the sidecar file, and never write
   comment markup into the `.md` itself.
5. Preserve the JSON structure exactly (2-space indent, trailing newline)
   so the review tool and OneDrive sync stay happy.

## Finding open agent comments quickly

```bash
# All sidecars with open agent comments, with the note they belong to:
for f in **/*.comments.json; do
  jq -e '[.comments[] | select(.for=="agent" and .status=="open")] | length > 0' "$f" \
    >/dev/null && echo "$f"
done

# The open agent comments for one note:
jq '[.comments[] | select(.for=="agent" and .status=="open")]' my-post.comments.json
```

## Learning from feedback

Resolved comments are a history of human corrections. When asked to improve
your writing for this folder, aggregate resolved comment texts across
sidecars and look for recurring feedback (tone, length, structure,
terminology) — then apply those patterns proactively to new drafts.
