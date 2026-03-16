import { Hono } from "https://deno.land/x/hono@v4.3.11/mod.ts";
import { fileRouter } from "./src/files.ts";
import { createUiRouter } from "./src/routes/ui.ts";
import { createApiRouter } from "./src/routes/api.ts";
import { PreviewDB } from "./src/db/sql.ts";

const dataDir = Deno.env.get("SMALLWEB_DATA_DIR") || "./data";
await Deno.mkdir(dataDir, { recursive: true });

const db = new PreviewDB(`${dataDir}/preview.db`);

const app = new Hono();

// Static assets
app.route("/static/*", fileRouter);

// UI
app.route("/", createUiRouter(db));

// API
app.route("/api", createApiRouter(db));

export default {
  fetch(request: Request) {
    return app.fetch(request);
  },
};
