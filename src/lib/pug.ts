// deno-lint-ignore-file no-explicit-any
import pug from "npm:pug@3.0.2";

const cache = new Map<string, pug.compileTemplate>();

function templatePath(file: string): string {
  return new URL(`../templates/${file}`, import.meta.url).pathname;
}

export function renderTemplate(file: string, locals: Record<string, any> = {}): string {
  const path = templatePath(file);
  const cached = cache.get(path);
  const tpl = cached ?? pug.compileFile(path, { filename: path, cache: true });
  if (!cached) cache.set(path, tpl);
  return tpl(locals);
}
