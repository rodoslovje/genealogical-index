#!/usr/bin/env node
// Build wrapper invoked from a site directory (sites/<name>/) via that site's
// `npm run build` script. If the site's site.config.js exports a non-empty
// PREMIUM_FEATURES list, this runs vite twice — once with BUILD_VARIANT=base
// (premium features stripped) into dist/base/, and once with BUILD_VARIANT=
// premium into dist/premium/. Otherwise it runs vite once into dist/.
//
// Each site's package.json points its `build` script at this file so the
// existing root scripts (build:slo, build:cro, …) stay the user-facing CLI.

import { spawnSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const siteDir = process.cwd();
const siteName = path.basename(siteDir);

// Resolve the local vite binary. npm workspaces hoist devDependencies to the
// repo root; fall back to the site's own node_modules just in case.
function resolveViteBin() {
  const candidates = [
    path.resolve(__dirname, '../node_modules/.bin/vite'),
    path.resolve(siteDir, 'node_modules/.bin/vite'),
  ];
  for (const p of candidates) if (existsSync(p)) return p;
  console.error('Could not find the vite binary in node_modules. Run `npm install` first.');
  process.exit(1);
}
const viteBin = resolveViteBin();

async function loadPremiumFeatures() {
  const configPath = path.join(siteDir, 'web/site.config.js');
  if (!existsSync(configPath)) {
    console.error(`No site.config.js found at ${configPath}`);
    process.exit(1);
  }
  const mod = await import(pathToFileURL(configPath).href);
  return Array.isArray(mod.PREMIUM_FEATURES) ? mod.PREMIUM_FEATURES : [];
}

function runViteBuild(variant) {
  const res = spawnSync(viteBin, ['build'], {
    cwd: siteDir,
    stdio: 'inherit',
    env: { ...process.env, BUILD_VARIANT: variant },
  });
  if (res.status !== 0) process.exit(res.status ?? 1);
}

const features = await loadPremiumFeatures();
const hasPremium = features.length > 0;

if (hasPremium) {
  // Wipe dist/ so leftovers from a previous single-variant build don't sit
  // alongside the new base/ and premium/ subdirs. Each vite run only empties
  // its own outDir (dist/base or dist/premium), not the parent.
  rmSync(path.join(siteDir, 'dist'), { recursive: true, force: true });

  console.log(`\n[${siteName}] Building base variant (premium features: stripped)\n`);
  runViteBuild('base');
  console.log(`\n[${siteName}] Building premium variant (premium features: ${features.join(', ')})\n`);
  runViteBuild('premium');
  console.log(`\n[${siteName}] Done. Output:\n  dist/base/    (public site)\n  dist/premium/ (gated site)\n`);
} else {
  console.log(`\n[${siteName}] Building single variant (no premium features defined)\n`);
  runViteBuild('');
}
