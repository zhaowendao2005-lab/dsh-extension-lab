#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const template = await readFile(path.join(root, "src/client.template.js"), "utf8");
const css = await readFile(path.join(root, "src/styles.css"), "utf8");
const catalogFile = path.resolve(root, "../../marketplace.json");

const production = !process.argv.includes("--development");
let market;
if (production) {
  market = {
    mode: "production",
    catalogUrl:
      "https://raw.githubusercontent.com/zhaowendao2005-lab/dsh-extension-lab/main/marketplace.json",
  };
} else {
  const catalog = JSON.parse(await readFile(catalogFile, "utf8"));
  const workspaceRoot = path.resolve(
    process.env.DSH_EXTENSION_LAB_ROOT || path.resolve(root, "../.."),
  );
  market = {
    mode: "development",
    extensions: catalog.extensions.map((item) => ({
      ...item,
      spec: "link:" + path.resolve(workspaceRoot, item.path),
    })),
  };
}

// Replace both markers in a single pass
let built = template
  .replace("__MARKET_CONFIG__", JSON.stringify(market))
  .replace("__MARKET_CSS__", JSON.stringify(css));

const out = path.join(root, "lib/client.js");
if (process.argv.includes("--check")) {
  const current = await readFile(out, "utf8").catch(() => "");
  if (current !== built) throw new Error("lib/client.js is stale; run npm run build");
  console.log("manager build is up to date");
} else {
  await writeFile(out, built);
  console.log("built extension-lab-manager (" + market.mode + ")");
}
