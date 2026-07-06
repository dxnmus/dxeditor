// DXEditor desktop shell. Boots the Express server in-process on a free
// localhost port, then opens a window pointed at it. All file access stays
// on this machine, same as the browser version.
import { app, BrowserWindow, Menu, shell } from "electron";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { createServer } from "../server/app.js";
import { setupUpdater, checkForUpdatesNow } from "./updater.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");

// One window, one embedded server.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();

let win = null;

/** First run only: create a starter workspace folder the user can edit. */
function ensureSeedRoot(dataDir) {
  const seedRoot = path.join(dataDir, "Welcome Notes");
  if (!fs.existsSync(path.join(dataDir, "workspaces.json"))) {
    fs.mkdirSync(seedRoot, { recursive: true });
    const welcome = path.join(seedRoot, "Welcome.md");
    if (!fs.existsSync(welcome)) {
      fs.writeFileSync(
        welcome,
        [
          "# Welcome to DXEditor",
          "",
          "This starter workspace lives inside the app's data folder.",
          "To work on real notes, open the workspace menu in the sidebar",
          "and choose **Add workspace**, then pick any folder on your",
          "computer — for shared work, pick your synced OneDrive folder.",
          "",
          "Your files stay as plain `.md` files on disk. Nothing is uploaded.",
        ].join("\n") + "\n",
        "utf8"
      );
    }
  }
  return seedRoot;
}

async function createWindow() {
  const dataDir = app.getPath("userData");
  const seedRoot = ensureSeedRoot(dataDir);

  const srv = createServer({
    dataDir,
    seedRoot,
    distDir: path.join(PROJECT_ROOT, "dist"),
  });
  const { port } = await srv.listen(0); // free port, localhost only

  win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 720,
    minHeight: 480,
    title: "DXEditor",
    backgroundColor: "#ffffff",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Open external links in the system browser, not in the app window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
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
