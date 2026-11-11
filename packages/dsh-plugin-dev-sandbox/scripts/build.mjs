#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const template = await readFile(path.join(root, "src/client.template.js"), "utf8");
const host = await readFile(path.join(root, "src/index.js"), "utf8");
if (!template.includes('window.__ModuleLoader__.load')) throw new Error("client template must use the DSH ModuleLoader");
if (!host.includes('export function apply')) throw new Error("host entrypoint must export apply");
await mkdir(path.join(root, "lib"), { recursive: true });
await writeFile(path.join(root, "lib/client.js"), template.endsWith("\n") ? template : template + "\n");
await writeFile(path.join(root, "lib/index.js"), host.endsWith("\n") ? host : host + "\n");
console.log("built dsh-plugin-dev-sandbox");
