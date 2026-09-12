// Merges several single-chip esp-web-tools manifests (one per ESP32 family,
// each produced by esphome/build-action) into one manifest whose `builds` array
// lists every chip. esp-web-tools then flashes the build that matches whatever
// board is connected. Prints the combined manifest to stdout.
//
// Usage: node merge-manifests.mjs a/manifest.json b/manifest.json ...

import { readFileSync } from 'node:fs';

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error('merge-manifests: no manifest files given');
  process.exit(1);
}

let combined = null;
const builds = [];

for (const file of files) {
  const manifest = JSON.parse(readFileSync(file, 'utf8'));
  if (!combined) {
    // Keep the top-level project fields from the first manifest; only the
    // builds array differs between chips.
    combined = {
      name: manifest.name,
      version: manifest.version,
      home_assistant_domain: manifest.home_assistant_domain,
      new_install_prompt_erase: manifest.new_install_prompt_erase,
      builds: []
    };
  }
  for (const build of manifest.builds || []) builds.push(build);
}

combined.builds = builds;
process.stdout.write(`${JSON.stringify(combined, null, 2)}\n`);
