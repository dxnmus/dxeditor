// electron-builder afterPack hook.
//
// We don't have an Apple Developer ID, so the app can't be notarized. But an
// unsigned arm64 app downloaded from the internet shows up as "damaged"
// because the leftover Electron signature no longer matches the modified
// bundle. Applying a valid *ad-hoc* signature fixes that: the app is no longer
// "damaged", it just shows the normal "unidentified developer" prompt that a
// one-time right-click > Open (or Open Anyway) clears.
//
// Runs after the .app is packed and before the .dmg/.zip are built, so the
// installers wrap the freshly signed app. macOS only; Windows is untouched.
const { execFileSync } = require("node:child_process");
const path = require("node:path");

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== "darwin") return;

  const appName = context.packager.appInfo.productFilename;
  const appPath = path.join(context.appOutDir, `${appName}.app`);

  execFileSync(
    "codesign",
    ["--force", "--deep", "--sign", "-", "--timestamp=none", appPath],
    { stdio: "inherit" }
  );
  console.log(`  • ad-hoc signed ${appPath}`);
};
