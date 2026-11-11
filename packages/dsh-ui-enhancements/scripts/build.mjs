#!/usr/bin/env node
/** Build the Client stylesheet bundle. */
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const TEMPLATE = path.join(root, "src/client.template.js");
const STYLES = path.join(root, "src/swiss.css");
const OUT = path.join(root, "lib/client.js");
const CSS_MARKER = "__SWISS_CSS__";

const [template, css] = await Promise.all([
  readFile(TEMPLATE, "utf8"),
  readFile(STYLES, "utf8"),
]);
if (template.split(CSS_MARKER).length - 1 !== 1) {
  console.error("build: template must contain the CSS marker exactly once");
  process.exit(1);
}
if (css.includes("</style")) {
  console.error("build: swiss.css must not contain a </style sequence");
  process.exit(1);
}

const built = template.replace(CSS_MARKER, JSON.stringify(css));
if (process.argv.includes("--check")) {
  const current = await readFile(OUT, "utf8").catch(() => "");
  if (current !== built) {
    console.error("build: lib/client.js is stale; run npm run build");
    process.exit(1);
  }
  console.log("build: lib/client.js up to date (" + built.length + " bytes)");
  process.exit(0);
}

await writeFile(OUT, built);
console.log("build: lib/client.js (" + css.length + " bytes CSS, " + built.length + " bytes bundle)");
