import { PreviewDB } from "../db/sql.ts";

export type AuthedUser = { token: string; name: string };

export function getEnvPassword(): string {
  return Deno.env.get("PREVIEW_PASSWORD") || "s@mpl3-p@ssw0rd";
}

export function getEffectivePassword(db: PreviewDB): string {
  return db.getSetting("global_password") || getEnvPassword();
}

export function getSessionTokenFromRequest(req: Request): string | null {
  return req.headers.get("X-Session-Token");
}

function getSessionTokenFromCookie(req: Request): string | null {
  const cookie = req.headers.get("cookie");
  if (!cookie) return null;
  const entries = cookie.split(";").map((part) => part.trim()).filter(Boolean);
  for (const entry of entries) {
    const [rawKey, ...rest] = entry.split("=");
    if (!rawKey || rest.length === 0) continue;
    if (rawKey === "preview_token") {
      return rest.join("=");
    }
  }
  return null;
}

export function requireAuth(db: PreviewDB, req: Request): AuthedUser | null {
  const token = getSessionTokenFromRequest(req) ?? getSessionTokenFromCookie(req);
  if (!token) return null;

  const session = db.getSession(token);
  if (!session) return null;

  if (session.expires_at < new Date().toISOString()) return null;

  return { token: session.token, name: session.name };
}
