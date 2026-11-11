#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const template = await readFile(path.join(root, "src/client.template.js"), "utf8");
const catalogFile = path.resolve(root, "../../marketplace.json");
const marker = "__MARKET_CONFIG__";
const production = !process.argv.includes("--development");
let market;
if (production) {
  market = { mode: "production", catalogUrl: "https://raw.githubusercontent.com/zhaowendao2005-lab/dsh-extension-lab/main/marketplace.json" };
} else {
  const catalog = JSON.parse(await readFile(catalogFile, "utf8"));
  market = {
    mode: "development",
    extensions: catalog.extensions.map((item) => ({
      ...item,
      spec: "link:/Volumes/Lenovo/dsh-extension-lab/" + item.path,
    })),
  };
}
const built = template.replace(marker, JSON.stringify(market));
const out = path.join(root, "lib/client.js");
if (process.argv.includes("--check")) {
  const current = await readFile(out, "utf8").catch(() => "");
  if (current !== built) throw new Error("lib/client.js is stale; run npm run build");
  console.log("manager build is up to date");
} else {
  await writeFile(out, built);
  console.log("built extension-lab-manager (" + market.mode + ")");
}
