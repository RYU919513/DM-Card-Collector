/**
 * build-preview.mjs
 *
 * Copies only the PWA delivery assets to dist/.
 * Explicitly excludes: node_modules, .git, test, docs, tools, scripts,
 * .agents, .codex, .github, *.mht, *.mhtml, and any build-only artefacts.
 *
 * Safe to run in Cloudflare Workers Builds (Static framework) where the
 * build environment may install devDependencies into node_modules.
 */

import { copyFileSync, mkdirSync, readdirSync, statSync, rmSync, existsSync } from 'fs';
import { join, relative } from 'path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const DIST = join(ROOT, 'dist');

// Explicit top-level file allowlist (relative to ROOT)
const ALLOWED_FILES = [
  'index.html',
  'sw.js',
  'manifest.webmanifest',
];

// Allowed top-level directories (copied recursively, with MHT filter)
const ALLOWED_DIRS = [
  'src',
  'icons',
];

// File extensions never included, regardless of directory
const BLOCKED_EXTENSIONS = new Set(['.mht', '.mhtml']);

function copyDir(src, dest) {
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src)) {
    const srcPath = join(src, entry);
    const destPath = join(dest, entry);
    const ext = entry.includes('.') ? '.' + entry.split('.').pop().toLowerCase() : '';
    if (BLOCKED_EXTENSIONS.has(ext)) continue;
    const stat = statSync(srcPath);
    if (stat.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      copyFileSync(srcPath, destPath);
    }
  }
}

// Clean dist
if (existsSync(DIST)) {
  rmSync(DIST, { recursive: true, force: true });
}
mkdirSync(DIST, { recursive: true });

// Copy allowed top-level files
for (const file of ALLOWED_FILES) {
  const src = join(ROOT, file);
  if (existsSync(src)) {
    copyFileSync(src, join(DIST, file));
    console.log(`copied  ${file}`);
  } else {
    console.error(`MISSING ${file}`);
    process.exit(1);
  }
}

// Copy allowed directories recursively
for (const dir of ALLOWED_DIRS) {
  const src = join(ROOT, dir);
  if (existsSync(src)) {
    copyDir(src, join(DIST, dir));
    console.log(`copied  ${dir}/`);
  } else {
    console.warn(`SKIP    ${dir}/ (not found)`);
  }
}

// Verify dist does not contain blocked paths
function assertNoBlocked(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const rel = relative(DIST, full);
    if (entry === 'node_modules' || entry === '.git') {
      console.error(`BLOCKED path found in dist: ${rel}`);
      process.exit(1);
    }
    const ext = entry.includes('.') ? '.' + entry.split('.').pop().toLowerCase() : '';
    if (BLOCKED_EXTENSIONS.has(ext)) {
      console.error(`BLOCKED file found in dist: ${rel}`);
      process.exit(1);
    }
    if (statSync(full).isDirectory()) assertNoBlocked(full);
  }
}
assertNoBlocked(DIST);

// List dist contents
console.log('\ndist contents:');
function listDir(dir, indent = '') {
  for (const entry of readdirSync(dir).sort()) {
    const full = join(dir, entry);
    const rel = relative(DIST, full);
    if (statSync(full).isDirectory()) {
      console.log(`${indent}${entry}/`);
      listDir(full, indent + '  ');
    } else {
      const size = statSync(full).size;
      console.log(`${indent}${entry}  (${size} bytes)`);
    }
  }
}
listDir(DIST);
console.log('\nbuild:preview OK');
