import { Hono } from "https://deno.land/x/hono@v4.3.11/mod.ts";
import { serveStatic } from "https://deno.land/x/hono@v4.3.11/middleware.ts";

export const fileRouter = new Hono();

// Serve everything under /
fileRouter.use("/*", async (c, next) => {
  try {
    return await serveStatic({ root: "./" })(c, next);
  } catch (e) {
    if (e instanceof Error && e.message.includes("os error 2")) return c.notFound();
    throw e;
  }
});

// MIME corrections (Deno can be picky)
fileRouter.use("/*", async (c, next) => {
  await next();
  const path = c.req.path;
  if (path.endsWith(".css")) c.header("Content-Type", "text/css; charset=utf-8");
  if (path.endsWith(".js")) c.header("Content-Type", "application/javascript; charset=utf-8");
  if (path.endsWith(".map")) c.header("Content-Type", "application/json; charset=utf-8");
});
