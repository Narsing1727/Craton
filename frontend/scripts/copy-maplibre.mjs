// MapLibre GL 6 draws in a module worker that it loads by address. A bundler renames the library's own files, so the worker and the shared
// module it imports are copied from node_modules into public/maplibre, where the map is told to find them (setWorkerUrl). Runs before every
// build and dev server, so the copy always matches the installed version.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const from = path.join(here, "..", "node_modules", "maplibre-gl", "dist");
const to = path.join(here, "..", "public", "maplibre");
fs.mkdirSync(to, { recursive: true });
for (const f of ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"]) fs.copyFileSync(path.join(from, f), path.join(to, f));
console.log("maplibre worker copied to public/maplibre");
