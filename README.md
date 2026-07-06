# Markdown Editor

A local, Notion-style editor for a folder of plain Markdown files. You point it
at a folder on your computer and get a clean writing app in your browser —
while your notes stay as portable `.md` files on disk. Nothing is uploaded
anywhere.

It's built to work with a shared **OneDrive** folder: each person runs their
own copy pointed at their synced copy of the shared folder, and OneDrive keeps
everyone's files in sync.

## What it does

- **Workspaces** — connect any number of folders: your personal drafts plus
  each shared school folder. Switch between them from the sidebar dropdown.
- **Comments for review** — select text in a draft and leave a comment tagged
  **🤖 For agent** or **👥 For team**. Commented text is highlighted; a side
  panel shows threads with reply/resolve. Comments live in a sidecar file
  (`post.md` → `post.comments.json`) so the draft itself stays clean.

- **Notion-style editing** — type and it formats in place. Press `/` for the
  block menu (headings, lists, tables, code, quotes). Select text for the
  formatting toolbar. Drag blocks to reorder.
- **Autosave** — changes save about a second after you stop typing. `Cmd+S`
  saves immediately.
- **Team-safe saving** — if a teammate's edit synced to disk while you were
  writing, you get a banner with "Take theirs / Keep mine" instead of a silent
  overwrite. Opening a note never modifies it.
- **Live sync** — when OneDrive delivers a change, the sidebar and open note
  update by themselves.
- **Command palette** — `Cmd+K` to jump to any note or run commands.
- **Wiki links** — type `[[` to link to another note; each note lists its
  "Linked mentions" underneath. Links between notes are saved as standard
  relative markdown links.
- **Properties** — YAML frontmatter (title, tags, dates) appears as an
  editable properties table, tags as chips.
- **The basics** — folders, right-click menus, inline rename, full-text
  search, light/dark themes, resizable sidebar.

Keyboard: `Cmd+K` palette · `Cmd+N` new note · `Cmd+S` save · `Cmd+\` sidebar.

## One-time setup

You need [Node.js](https://nodejs.org) 20 or newer.

```bash
cd ~/Documents/md-editor
npm install
cp .env.example .env
```

Open `.env` and set `ROOT_DIR` to your folder. For OneDrive on a Mac it looks
something like:

```
ROOT_DIR=/Users/you/Library/CloudStorage/OneDrive-YourOrg/SharedNotes
```

> Tip: drag the folder from Finder into Terminal to get its full path.

If you skip this, it uses the included `sample-notes` folder so you can try it.

## Running it

```bash
npm run serve
```

Open **http://localhost:3001**. Stop with `Ctrl+C`.

For development with hot reload: `npm run dev`, then open http://localhost:5173.

## Sharing with your team

1. Give each teammate a copy of this folder (or share it via a repo).
2. Each person runs `npm install` once and points their own `.env` at their
   OneDrive-synced copy of the shared folder.
3. Everyone edits normally; OneDrive syncs the files.

Because syncing happens through OneDrive rather than instantly, this suits
"we each work on different notes." If two people do touch the same note, the
conflict banner stops the second save from silently erasing the first.

## Using with Claude Code pipelines

This tool is built to be the human end of an agentic content workflow:

1. Your pipeline (Claude Code) writes drafts into a shared folder.
2. Reviewers read them here and leave comments — "For agent" comments are
   instructions for the pipeline; "For team" comments are for colleagues.
3. In the workspace menu (sidebar dropdown → 🤖), click **Add agent
   instructions** once per folder. This writes an `AGENTS.md` that tells any
   Claude Code run exactly how to find open agent comments, apply them to the
   draft, mark them resolved, and reply with what changed.
4. When the agent resolves a comment, your screen updates live: the draft
   text changes, the highlight clears, and the comment shows the agent's
   reply.

Resolved comments accumulate into a feedback history the pipeline can mine
for recurring guidance (tone, length, structure) and apply proactively.

## Notes on file safety

- The app can only see and change files inside `ROOT_DIR`. Path traversal is
  blocked server-side.
- Only `.md`, `.markdown`, `.mdown`, and `.txt` files are shown or written.
- Deletes always ask for confirmation.

## Desktop app

The same app ships as a double-click desktop app (Electron). It embeds the
server, so there is nothing to run in a terminal — teammates just install it.

```bash
npm run app:dev      # run the desktop app from source
npm run app:build    # package installers into release/ (no publishing)
```

- **macOS**: `release/DXEditor-<version>-arm64.dmg` (Intel builds via CI).
  The app is not code-signed yet, so the first launch needs right-click →
  Open.
- **Windows**: `release/DXEditor Setup <version>.exe` (one-click installer).
- Desktop settings (`workspaces.json`, the starter workspace) live in the
  OS app-data folder, not in this project.

### Updates

The app checks GitHub Releases (`dxnmus/dxeditor`) on launch and every few
hours. Windows updates install automatically after a restart prompt. macOS
shows a "Download" prompt (silent install needs code signing — flip
`MAC_FULL_AUTO` in `electron/updater.js` once the app is signed).

To publish a new version:

```bash
npm version patch        # or minor / major — bumps version + tags
git push --follow-tags   # GitHub Actions builds mac + win and publishes
```

While the repo is private, only people signed into GitHub with access can
download updates; make the repo public when ready to roll out to the team.
