// Update checks against GitHub Releases (see "publish" in package.json).
//
// Windows: true auto-update — download in the background, prompt to restart.
// macOS: the app is not code-signed yet, and macOS refuses to auto-install
// unsigned updates. So on Mac we detect the new version and send the user to
// the download page instead. If we sign the app later, flip MAC_FULL_AUTO.
import { app, dialog, shell } from "electron";
import electronUpdater from "electron-updater";

const { autoUpdater } = electronUpdater;

const MAC_FULL_AUTO = false; // set true once the app is signed + notarized
const isMac = process.platform === "darwin";
const manualOnMac = isMac && !MAC_FULL_AUTO;

let getWin = () => null;
let checkingInteractively = false;

export function setupUpdater(getWindow) {
  getWin = getWindow;
  if (!app.isPackaged) return; // dev runs have no app-update.yml

  autoUpdater.autoDownload = !manualOnMac;
  autoUpdater.autoInstallOnAppQuit = !manualOnMac;

  autoUpdater.on("update-available", (info) => {
    if (manualOnMac) promptMacDownload(info);
  });

  autoUpdater.on("update-downloaded", (info) => {
    if (manualOnMac) return;
    dialog
      .showMessageBox(getWin(), {
        type: "info",
        title: "Update ready",
        message: `DXEditor ${info.version} has been downloaded.`,
        detail: "Restart the app to use the new version.",
        buttons: ["Restart Now", "Later"],
        defaultId: 0,
        cancelId: 1,
      })
      .then(({ response }) => {
        if (response === 0) autoUpdater.quitAndInstall();
      });
  });

  autoUpdater.on("update-not-available", () => {
    if (checkingInteractively) {
      checkingInteractively = false;
      dialog.showMessageBox(getWin(), {
        type: "info",
        title: "No updates",
        message: `You're on the latest version (${app.getVersion()}).`,
      });
    }
  });

  autoUpdater.on("error", (err) => {
    // Never block the editor over an update problem; just log it.
    console.error("[updater]", err?.message || err);
    if (checkingInteractively) {
      checkingInteractively = false;
      dialog.showMessageBox(getWin(), {
        type: "warning",
        title: "Update check failed",
        message: "Could not check for updates.",
        detail: String(err?.message || err),
      });
    }
  });

  // Check shortly after launch, then every 4 hours while the app stays open.
  setTimeout(() => autoUpdater.checkForUpdates().catch(() => {}), 10_000);
  setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), 4 * 60 * 60 * 1000);
}

/** "Check for Updates…" menu item. */
export function checkForUpdatesNow() {
  if (!app.isPackaged) {
    dialog.showMessageBox(getWin(), {
      type: "info",
      title: "Development build",
      message: "Update checks only run in the packaged app.",
    });
    return;
  }
  checkingInteractively = true;
  autoUpdater.checkForUpdates().catch(() => {});
}

function promptMacDownload(info) {
  checkingInteractively = false;
  const url = "https://github.com/dxnmus/dxeditor/releases/latest";
  dialog
    .showMessageBox(getWin(), {
      type: "info",
      title: "Update available",
      message: `DXEditor ${info.version} is available (you have ${app.getVersion()}).`,
      detail:
        "Click Download to get the new version, then drag it into " +
        "Applications to replace this one.",
      buttons: ["Download", "Later"],
      defaultId: 0,
      cancelId: 1,
    })
    .then(({ response }) => {
      if (response === 0) shell.openExternal(url);
    });
}
