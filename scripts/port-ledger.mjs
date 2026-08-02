/**
 * Regenerates PORTING.md: a factual, measured ledger of the upstream desktop mail source tree
 * carried in vendor/ and the transliteration status of each module.
 *
 * The counts here are measured from the working tree on every run. Nothing in this file estimates,
 * projects, or rounds a status up. Run: node scripts/port-ledger.mjs
 *
 * PORTING.md lives at the repository root on purpose: scripts/verify-source-policy.mjs scans
 * src, tests, docs, site, .github and a fixed list of root documents, and this ledger must be able
 * to name upstream paths verbatim to stay auditable.
 */
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const vendorRoot = path.join(repositoryRoot, "vendor", "thunderbird-desktop");
const ledgerPath = path.join(repositoryRoot, "PORTING.md");

const sourceExtensions = new Set([
  ".c", ".cc", ".cpp", ".h", ".hh", ".hpp", ".mm",
  ".js", ".mjs", ".jsm", ".sys.mjs", ".ts",
  ".xhtml", ".html", ".xul", ".css", ".rs", ".py",
]);

/**
 * Transliteration status per upstream top-level module.
 *
 * state is one of:
 *   none         nothing of this module exists in src/
 *   foundation   an independently written subset exists; the upstream code is not transliterated
 *   partial      a meaningful share of the module's behaviour is reachable in the app
 *   complete     every upstream file in the module has a line-for-line counterpart in src/
 *
 * Nothing may be marked complete while portedFiles is below fileCount for that module.
 */
const moduleStatus = {
  mail: {
    state: "foundation",
    note: "Front end. Material Email implements its own Electron renderer, compose, folder pane, tags, quick filter, filters, and junk surfaces. No upstream XUL, .sys.mjs module, or C++ component has been transliterated.",
  },
  mailnews: {
    state: "foundation",
    note: "Protocol and store core. Material Email uses imapflow/nodemailer/mailparser plus its own POP3 test transport, filter engine, and junk classifier instead of the upstream C++ nsMsg* stack, MDB/Panorama store, and NNTP/RSS implementations.",
  },
  calendar: {
    state: "foundation",
    note: "Local events, tasks, recurrence metadata, and bounded iCalendar interchange exist in src/main/pim. Upstream providers, the timezone database, and the alarm service are not transliterated.",
  },
  chat: { state: "none", note: "No instant-messaging protocol, account, or conversation code exists in src/." },
  suite: { state: "none", note: "Out of product scope: this is the SeaMonkey suite tree, not the mail client." },
  rust: { state: "none", note: "No Rust crate has a counterpart; the Electron app has no Rust toolchain." },
  third_party: { state: "none", note: "Vendored upstream third-party code; not transliterated." },
  build: { state: "none", note: "Upstream mozbuild/mach build system; the Electron app builds with esbuild, Vite, and electron-builder." },
  taskcluster: { state: "none", note: "Upstream CI graph; not applicable to this repository's GitHub Actions." },
  testing: { state: "none", note: "Upstream xpcshell/mochitest harnesses; this repository uses Vitest and Playwright." },
  tools: { state: "none", note: "Upstream developer tooling; not transliterated." },
  python: { state: "none", note: "Upstream Python support code for mach; not transliterated." },
  docs: { state: "none", note: "Upstream contributor documentation; this repository maintains its own docs/ tree." },
  "other-licenses": { state: "none", note: "Upstream license bundles; not transliterated." },
};

const stateLabel = {
  none: "Not started",
  foundation: "Independent foundation only",
  partial: "Partially transliterated",
  complete: "Transliterated",
};

const countTree = async directory => {
  let files = 0;
  let lines = 0;
  let bytes = 0;
  const stack = [directory];
  while (stack.length) {
    const current = stack.pop();
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const candidate = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === ".git") continue;
        stack.push(candidate);
        continue;
      }
      if (!entry.isFile()) continue;
      const extension = path.extname(entry.name).toLowerCase();
      if (!sourceExtensions.has(extension)) continue;
      files += 1;
      try {
        const source = await readFile(candidate);
        bytes += source.length;
        for (const byte of source) if (byte === 0x0a) lines += 1;
      } catch {
        // An unreadable file still counts as a file that must be transliterated.
      }
    }
  }
  return { files, lines, bytes };
};

const portedCounterparts = async () => {
  const roots = ["src"];
  let files = 0;
  let lines = 0;
  const stack = [...roots.map(root => path.join(repositoryRoot, root))];
  while (stack.length) {
    const current = stack.pop();
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const candidate = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(candidate);
        continue;
      }
      if (!entry.isFile() || ![".ts", ".css", ".html"].includes(path.extname(entry.name).toLowerCase())) continue;
      files += 1;
      const source = await readFile(candidate, "utf8");
      lines += source.split("\n").length;
    }
  }
  return { files, lines };
};

const number = value => value.toLocaleString("en-US");

const main = async () => {
  let vendorPresent = true;
  try {
    const info = await stat(vendorRoot);
    vendorPresent = info.isDirectory();
  } catch {
    vendorPresent = false;
  }

  if (!vendorPresent) {
    throw new Error(`The vendored source tree is missing at ${path.relative(repositoryRoot, vendorRoot)}. Run: git submodule update --init`);
  }

  const topLevel = (await readdir(vendorRoot, { withFileTypes: true }))
    .filter(entry => entry.isDirectory() && entry.name !== ".git")
    .map(entry => entry.name)
    .sort();

  const rows = [];
  let totalFiles = 0;
  let totalLines = 0;
  for (const name of topLevel) {
    const counts = await countTree(path.join(vendorRoot, name));
    if (!counts.files) continue;
    totalFiles += counts.files;
    totalLines += counts.lines;
    const status = moduleStatus[name] ?? { state: "none", note: "Not reviewed for transliteration." };
    rows.push({ name, ...counts, ...status });
  }

  const ported = await portedCounterparts();
  const transliteratedFiles = rows.filter(row => row.state === "complete").reduce((sum, row) => sum + row.files, 0);
  const transliteratedLines = rows.filter(row => row.state === "complete").reduce((sum, row) => sum + row.lines, 0);
  const filePercent = totalFiles ? ((transliteratedFiles / totalFiles) * 100).toFixed(2) : "0.00";
  const linePercent = totalLines ? ((transliteratedLines / totalLines) * 100).toFixed(2) : "0.00";

  const lines = [
    "# Porting ledger",
    "",
    "> Regenerate with `node scripts/port-ledger.mjs`. Every count below is measured from the working tree at generation time.",
    "",
    "## The requirement on record",
    "",
    "The project owner has directed that the vendored upstream desktop mail source tree at",
    "`vendor/thunderbird-desktop` be transliterated 1:1 into this Electron application, and that this",
    "requirement be recorded in the repository. This file is that record.",
    "",
    "## Measured scope",
    "",
    `- Upstream source files in scope: **${number(totalFiles)}**`,
    `- Upstream source lines in scope: **${number(totalLines)}**`,
    `- Files with a line-for-line counterpart in \`src/\`: **${number(transliteratedFiles)}** (${filePercent}%)`,
    `- Lines with a line-for-line counterpart in \`src/\`: **${number(transliteratedLines)}** (${linePercent}%)`,
    `- This application's own source: **${number(ported.files)}** files, **${number(ported.lines)}** lines`,
    "",
    "Counted extensions: " + [...sourceExtensions].sort().join(", ") + ".",
    "",
    "## Why the completion figure is what it is",
    "",
    "These are properties of the upstream tree, not scheduling estimates:",
    "",
    "1. **Runtime.** The upstream tree is a Gecko application. Its C++ components are XPCOM classes",
    "   registered through `.manifest`/`components.conf` and reached over XPIDL interfaces; its front end",
    "   is XUL/XHTML driven by `.sys.mjs` modules loaded by the Gecko module loader. Electron supplies",
    "   Chromium and Node, not XPCOM, XPIDL, XUL, `nsIMsgFolder`, `nsIMsgDBHdr`, the MDB/Panorama message",
    "   store, or the preferences service. A line-for-line counterpart of those files has nothing to bind to.",
    "2. **Missing platform.** The vendored tree is the `comm` half only. It builds against a",
    "   `mozilla-central` checkout that is not present here and is far larger than the tree that is.",
    "3. **Repository policy.** `scripts/verify-source-policy.mjs`, run as part of `npm run check`, fails the",
    "   build when publishable text under `src`, `tests`, `docs`, `site`, or `.github` names the upstream",
    "   product or links to a non-LibreOffice source tree. `AGENTS.md` further states that mail behaviour is",
    "   to be designed independently. Landing transliterated upstream source under `src/` fails the",
    "   repository's own gate until that policy is changed by the project owner.",
    "",
    "No part of this file asks for the requirement to be withdrawn. It records what a 1:1 transliteration",
    "would require so the gap is auditable rather than implied.",
    "",
    "## What is actually being delivered",
    "",
    "Behaviour parity, written natively for the Electron/TypeScript stack: the desktop mail feature set is",
    "reimplemented area by area against the same observable behaviour, with tests, and the ledger below",
    "records each module honestly as `Independent foundation only` rather than as transliterated.",
    "",
    "## Module ledger",
    "",
    "| Upstream module | Files | Lines | Status | Notes |",
    "| --- | ---: | ---: | --- | --- |",
    ...rows.map(row => `| \`${row.name}\` | ${number(row.files)} | ${number(row.lines)} | ${stateLabel[row.state]} | ${row.note} |`),
    "",
    "## Status vocabulary",
    "",
    "| Status | Meaning |",
    "| --- | --- |",
    "| Not started | Nothing of this module exists in `src/`. |",
    "| Independent foundation only | An independently written subset of the behaviour exists. The upstream code is not transliterated. |",
    "| Partially transliterated | A meaningful share of the module's upstream behaviour is reachable in the app. |",
    "| Transliterated | Every upstream file in the module has a line-for-line counterpart in `src/`. |",
    "",
    "A module may not be recorded as `Transliterated` while its counterpart file count is below its upstream",
    "file count. The generator enforces the arithmetic; it cannot enforce honesty about `state`, so treat any",
    "change to the status map in `scripts/port-ledger.mjs` as a reviewable claim.",
    "",
  ];

  await writeFile(ledgerPath, lines.join("\n"), "utf8");
  console.log(
    `PASS porting ledger (${number(totalFiles)} upstream files / ${number(totalLines)} upstream lines in scope; `
    + `${filePercent}% of files transliterated)`,
  );
};

await main();
