import { renderTemplate } from "./pug.ts";

export function layout(opts: {
  title: string;
  userName?: string | null;
  body: string;
  active?: "dashboard" | "preview" | "admin" | "login";
}) {
  return renderTemplate("layout.pug", opts);
}
