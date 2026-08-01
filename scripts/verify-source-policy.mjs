import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const roots = ["src", "tests", "docs", "site", ".github"];
const rootFiles = ["README.md", "AGENTS.md", "CONTRIBUTING.md", "SECURITY.md", "CODE_OF_CONDUCT.md", "ROADMAP.md", "HANDOFF.md"];
const textExtensions = new Set([".ts", ".js", ".mjs", ".md", ".html", ".css", ".json", ".yml", ".yaml"]);
const forbiddenProduct = ["thunder", "bird"].join("");
const files = [...rootFiles];

const collect = async directory => {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const candidate = path.join(directory, entry.name);
    if (entry.isDirectory()) await collect(candidate);
    else if (textExtensions.has(path.extname(entry.name).toLowerCase())) files.push(candidate);
  }
};

for (const root of roots) await collect(root);

const violations = [];
for (const file of files) {
  const source = await readFile(file, "utf8");
  if (source.toLowerCase().includes(forbiddenProduct)) violations.push(`${file}: forbidden external product reference`);

  for (const match of source.matchAll(/https:\/\/github\.com\/([^/\s)]+)\/([^/\s)]+)\/(?:blob|tree)\//gi)) {
    const owner = match[1]?.toLowerCase();
    const repository = match[2]?.toLowerCase();
    if (owner !== "libreoffice" || repository !== "core") {
      violations.push(`${file}: external product source link is not LibreOffice/core (${match[0]})`);
    }
  }
}

if (violations.length) throw new Error(`Source-reference policy failed:\n${violations.join("\n")}`);
console.log(`PASS source-reference policy (${files.length} publishable text files; LibreOffice/core only)`);
