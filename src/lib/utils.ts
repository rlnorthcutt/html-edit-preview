export function nowIso(): string {
  return new Date().toISOString();
}

export function safeText(s: unknown): string {
  return String(s ?? "").trim();
}

export function clampText(s: string, max = 5000): string {
  return s.length <= max ? s : s.slice(0, max);
}

export function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}
