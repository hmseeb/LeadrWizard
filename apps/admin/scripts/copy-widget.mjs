#!/usr/bin/env node
// Copies the built widget bundle into apps/admin/public/widget.js so the
// /onboard host page can load it from the same origin as the admin app.
// Runs as part of `pnpm build` before `next build`.
//
// The widget is built separately by apps/widget (Vite IIFE → dist/widget.js).
// Turbo's `^build` ensures apps/widget builds first because admin declares
// @leadrwizard/widget as a workspace devDependency.

import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = resolve(__dirname, "../../widget/dist/widget.js");
const destDir = resolve(__dirname, "../public");
const dest = resolve(destDir, "widget.js");

if (!existsSync(src)) {
  console.error(
    `[copy-widget] widget bundle not found at ${src}.\n` +
      `Run \`pnpm --filter @leadrwizard/widget build\` first, or rely on turbo's ^build ordering.`
  );
  process.exit(1);
}

if (!existsSync(destDir)) {
  mkdirSync(destDir, { recursive: true });
}

copyFileSync(src, dest);
console.log(`[copy-widget] ${src} → ${dest}`);
