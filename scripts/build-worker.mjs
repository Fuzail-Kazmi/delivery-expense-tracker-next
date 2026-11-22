import { build } from "esbuild";
import { randomUUID } from "node:crypto";
await build({
  entryPoints: ["worker/service-worker.js"],
  outfile: "public/sw.js",
  bundle: true,
  minify: true,
  format: "iife",
  target: "es2020",
  define: { OFFLINE_BUILD: JSON.stringify(randomUUID()) },
});
