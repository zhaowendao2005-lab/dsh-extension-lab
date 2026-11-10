#!/usr/bin/env node
/** Build the Client bundle with an explicit catalog source mode. */
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const TEMPLATE = path.join(root, "src/client.template.js");
const STYLES = path.join(root, "src/swiss.css");
const DEV_CATALOG = path.join(root, "src/catalog.development.json");
const OUT = path.join(root, "lib/client.js");
const CSS_MARKER = "__SWISS_CSS__";
const MARKET_MARKER = "__MARKET_CONFIG__";
const production = !process.argv.includes("--development");

const [template, css] = await Promise.all([
  readFile(TEMPLATE, "utf8"),
  readFile(STYLES, "utf8"),
]);
const cssCount = template.split(CSS_MARKER).length - 1;
const marketCount = template.split(MARKET_MARKER).length - 1;
if (cssCount !== 1 || marketCount !== 1) {
  console.error("build: template must contain each marker exactly once (CSS: " + cssCount + ", market: " + marketCount + ")");
  process.exit(1);
}
if (css.includes("</style")) {
  console.error("build: swiss.css must not contain a </style sequence");
  process.exit(1);
}

let market;
if (production) {
  market = {
    mode: "production",
    catalogUrl: "https://raw.githubusercontent.com/zhaowendao2005-lab/dsh-extension-lab/main/marketplace.json",
  };
} else {
  const dev = JSON.parse(await readFile(DEV_CATALOG, "utf8"));
  if (!Array.isArray(dev.extensions)) throw new Error("development catalog must have an extensions array");
  market = {
    mode: "development",
    extensions: dev.extensions.map((item) => {
      if (!item.name || !item.title || !item.version || !item.path || item.path.startsWith("/") || item.path.includes("..")) {
        throw new Error("invalid development extension entry: " + JSON.stringify(item));
      }
      return { ...item, spec: "link:/Volumes/Lenovo/dsh-extension-lab/" + item.path };
    }),
  };
}

const built = template
  .replace(CSS_MARKER, JSON.stringify(css))
  .replace(MARKET_MARKER, JSON.stringify(market));
if (process.argv.includes("--check")) {
  const current = await readFile(OUT, "utf8").catch(() => "");
  if (current !== built) {
    console.error("build: lib/client.js is stale; run npm run build or npm run build:dev");
    process.exit(1);
  }
  console.log("build: lib/client.js up to date (" + built.length + " bytes, " + market.mode + ")");
  process.exit(0);
}

await writeFile(OUT, built);
console.log("build: lib/client.js (" + css.length + " bytes CSS, " + built.length + " bytes bundle, " + market.mode + ")");
