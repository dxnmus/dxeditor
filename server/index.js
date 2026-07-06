// CLI entry: `npm run serve` / `npm start`. The Electron app imports
// createServer from ./app.js directly instead of running this file.
import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "./app.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");
const PORT = Number(process.env.PORT) || 3001;
const isProd = process.env.NODE_ENV === "production";

const seedRoot = path.resolve(PROJECT_ROOT, process.env.ROOT_DIR || "./sample-notes");

let srv;
try {
  srv = createServer({
    dataDir: PROJECT_ROOT,
    seedRoot,
    distDir: isProd ? path.join(PROJECT_ROOT, "dist") : undefined,
  });
} catch (err) {
  console.error(
    `\n[md-editor] ${err.message}\n\n` +
      `Set ROOT_DIR in your .env file to the folder you want to edit ` +
      `(e.g. your OneDrive folder), then restart.\n`
  );
  process.exit(1);
}

srv.listen(PORT).then(({ port }) => {
  const list = srv.workspaces.list();
  console.log(`\n[md-editor] workspaces: ${list.map((w) => w.name).join(", ")}`);
  if (isProd) {
    console.log(`[md-editor] open: http://localhost:${port}\n`);
  } else {
    console.log(`[md-editor] API on http://localhost:${port}`);
    console.log(`[md-editor] open the app at http://localhost:5173\n`);
  }
});
