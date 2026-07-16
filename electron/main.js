// DXEditor desktop shell. Boots the Express server in-process on a free
// localhost port, then opens a window pointed at it. All file access stays
// on this machine, same as the browser version.
import { app, BrowserWindow, Menu, shell } from "electron";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { createServer } from "../server/app.js";
import { setupUpdater, checkForUpdatesNow } from "./updater.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");

// One window, one embedded server.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();

let win = null;

/** Where the shipped guide lives: app resources when packaged, repo in dev. */
function bundledGuideDir() {
  const packaged = path.join(process.resourcesPath || "", "guide");
  if (app.isPackaged && fs.existsSync(packaged)) return packaged;
  return path.join(PROJECT_ROOT, "guide");
}

/**
 * Rebuild the "DXEditor Guide" workspace from the shipped copy on every launch
 * so the docs always match the installed version. These pages are meant to be
 * read-only; any edits are replaced on the next launch.
 */
function refreshGuide(dataDir) {
  const src = bundledGuideDir();
  const dest = path.join(dataDir, "DXEditor Guide");
  if (fs.existsSync(src)) {
    fs.rmSync(dest, { recursive: true, force: true });
    fs.cpSync(src, dest, { recursive: true });
  } else {
    fs.mkdirSync(dest, { recursive: true });
  }
  return dest;
}

/** First-run scratch workspace so a new user has somewhere to write. */
function ensureScratch(dataDir) {
  const dest = path.join(dataDir, "My Notes");
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
    fs.writeFileSync(
      path.join(dest, "Untitled.md"),
      "# My Notes\n\n" +
        "This workspace is yours. Anything you write here stays on your " +
        "computer.\nTo connect a shared folder, use the workspace dropdown at " +
        "the top of the\nsidebar and choose Add workspace.\n",
      "utf8"
    );
  }
  return dest;
}

/**
 * Keep workspaces.json sane: the guide is always present and listed first, and
 * the scratch workspace is created on first run only. Anything the user adds
 * later is preserved. Written before the server reads the registry.
 */
function setupWorkspaces(dataDir, guideRoot) {
  const registryPath = path.join(dataDir, "workspaces.json");
  const firstRun = !fs.existsSync(registryPath);
  let list = [];
  if (!firstRun) {
    try {
      list = JSON.parse(fs.readFileSync(registryPath, "utf8")).workspaces || [];
    } catch {
      list = [];
    }
  }
  const newId = () => crypto.randomBytes(4).toString("hex");
  const sameRoot = (a, b) => path.resolve(a) === path.resolve(b);

  if (firstRun) {
    const scratch = ensureScratch(dataDir);
    list = [
      { id: newId(), name: "DXEditor Guide", root: guideRoot },
      { id: newId(), name: "My Notes", root: scratch },
    ];
  } else if (!list.some((w) => sameRoot(w.root, guideRoot))) {
    list.unshift({ id: newId(), name: "DXEditor Guide", root: guideRoot });
  }
  fs.writeFileSync(
    registryPath,
    JSON.stringify({ workspaces: list }, null, 2) + "\n",
    "utf8"
  );
}

async function createWindow() {
  const dataDir = app.getPath("userData");
  const guideRoot = refreshGuide(dataDir);
  setupWorkspaces(dataDir, guideRoot);

  const srv = createServer({
    dataDir,
    seedRoot: guideRoot, // exists; only used if workspaces.json is missing
    distDir: path.join(PROJECT_ROOT, "dist"),
  });
  const { port } = await srv.listen(0); // free port, localhost only

  const isMac = process.platform === "darwin";

  win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 720,
    minHeight: 480,
    title: "DXEditor",
    // Modern macOS chrome: hide the title bar so content runs edge to edge and
    // the traffic lights float over the sidebar. We keep a solid sidebar (no
    // vibrancy) so its color is identical to the browser build. Other
    // platforms keep a normal title bar (they still get the refreshed styling).
    ...(isMac
      ? {
          titleBarStyle: "hiddenInset",
          trafficLightPosition: { x: 14, y: 18 },
          backgroundColor: "#ffffff",
        }
      : { backgroundColor: "#ffffff" }),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      // Chromium's built-in PDF viewer counts as a plugin; without this the
      // in-app PDF preview downloads the file instead of rendering it.
      plugins: true,
    },
  });

  // Tell the UI it's running inside the macOS hidden-title-bar shell so it can
  // make room for the floating traffic lights and drag from the top area.
  if (isMac) {
    win.webContents.on("dom-ready", () => {
      win.webContents
        .executeJavaScript('document.body.classList.add("mac-shell")')
        .catch(() => {});
    });
  }

  // Open external links in the system browser, not in the app window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  // A plain <a href> click navigates the window itself rather than opening a
  // popup; keep the app pinned to its localhost origin and send everything
  // else to the system browser too.
  win.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(`http://127.0.0.1:${port}`)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  await win.loadURL(`http://127.0.0.1:${port}`);
}

function buildMenu() {
  const isMac = process.platform === "darwin";
  const template = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: "about" },
              {
                label: "Check for Updates…",
                click: () => checkForUpdatesNow(),
              },
              { type: "separator" },
              { role: "hide" },
              { role: "hideOthers" },
              { role: "unhide" },
              { type: "separator" },
              { role: "quit" },
            ],
          },
        ]
      : []),
    { role: "fileMenu" },
    { role: "editMenu" },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    { role: "windowMenu" },
    {
      role: "help",
      submenu: [
        ...(isMac
          ? []
          : [
              {
                label: "Check for Updates…",
                click: () => checkForUpdatesNow(),
              },
            ]),
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(async () => {
  buildMenu();
  await createWindow();
  setupUpdater(() => win);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("second-instance", () => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
