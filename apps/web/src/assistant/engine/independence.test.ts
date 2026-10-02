import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..");
const CHANNEL_SPECIFIC = new Set(["adapters", "renderers", "analytics"]);

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return CHANNEL_SPECIFIC.has(name) ? [] : sources(path);
    return /\.tsx?$/u.test(name) && !/\.test\.tsx?$/u.test(name) ? [path] : [];
  });
}

describe("channel independence", () => {
  const files = sources(ROOT);

  it("finds the engine sources", () => expect(files.length).toBeGreaterThan(10));

  it("the engine, flows and services import no React, DOM, Next.js, lib/api or Telegram code", () => {
    const banned = /from\s+["'](react|react-dom|next|next\/[^"']*|@tanstack\/[^"']*|lucide-react|grammy|telegraf|node-telegram-bot-api)["']|from\s+["'](\.\.\/)+(lib|app|components)\//u;
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      expect(text, file).not.toMatch(banned);
    }
  });

  it("uses no browser globals", () => {
    const globals = /\b(window|document|localStorage|sessionStorage|navigator)\./u;
    for (const file of files) {
      if (file.endsWith(join("persistence", "store.ts"))) continue;
      expect(readFileSync(file, "utf8"), file).not.toMatch(globals);
    }
  });

  it("does not read a username as identity", () => {
    for (const file of files) expect(readFileSync(file, "utf8"), file).not.toMatch(/channelUsername/u);
  });

  it("no log statements anywhere in the engine", () => {
    for (const file of files) expect(readFileSync(file, "utf8"), file).not.toMatch(/console\.(log|info|warn|error|debug)/u);
  });
});
