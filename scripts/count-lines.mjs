import { spawn } from "node:child_process";

const args = process.argv.slice(2);
const wantsJson = args.includes("--json");
const revFlag = args.indexOf("--rev");
const requestedRev = revFlag === -1 ? "HEAD" : args[revFlag + 1];
if (!requestedRev) throw new Error("--rev needs a commit-ish.");

const git = (gitArgs, input) =>
  new Promise((resolve, reject) => {
    const child = spawn("git", gitArgs, { stdio: ["pipe", "pipe", "pipe"] });
    const out = [];
    const err = [];
    child.stdout.on("data", chunk => out.push(chunk));
    child.stderr.on("data", chunk => err.push(chunk));
    child.on("error", reject);
    child.on("close", code => {
      if (code === 0) resolve(Buffer.concat(out));
      else reject(new Error(`git ${gitArgs.join(" ")} exited ${code}: ${Buffer.concat(err).toString("utf8").trim()}`));
    });
    child.stdin.end(input ?? "");
  });
const gitText = async (gitArgs, input) => (await git(gitArgs, input)).toString("utf8");

const mapLimited = async (items, limit, worker) => {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await worker(items[index]);
      }
    }),
  );
  return results;
};

// A line count is a fact about one commit, so every figure here comes from the object database.
// Reading the working tree would count another agent's half-saved edit, and `npm version` in CI
// dirties package.json before the release notes are written.
const rev = (await gitText(["rev-parse", "--verify", `${requestedRev}^{commit}`])).trim();
const shortRev = (await gitText(["rev-parse", "--short", rev])).trim();

const entries = (await gitText(["ls-tree", "-r", rev, "--format=%(objectmode)\t%(objectname)\t%(path)"]))
  .split("\n")
  .filter(line => line.length > 0)
  .map(line => {
    const [mode, oid, ...rest] = line.split("\t");
    return { mode, oid, path: rest.join("\t") };
  });

// Git's own binary heuristic, rather than an extension list that would guess wrong on a new asset kind.
const emptyTree = (await gitText(["mktree"], "")).trim();
const binaryPaths = new Set(
  (await gitText(["diff", "--numstat", emptyTree, rev]))
    .split("\n")
    .filter(line => line.startsWith("-\t-\t"))
    .map(line => line.slice(4)),
);

const root = path => !path.includes("/");
const extension = path => path.slice(path.lastIndexOf(".") + 1).toLowerCase();

const heldOut = [
  {
    // Named generically because this table is republished into README.md and the release notes, which the source-reference policy scans.
    label: "Vendored submodule (`vendor/`)",
    why: "Another project's source, recorded as a gitlink; it has no lines of ours to count.",
    match: entry => entry.mode === "160000",
  },
  {
    label: "Bundled binary assets",
    why: "Dim-sum catalog images and other binaries have no lines.",
    match: entry => binaryPaths.has(entry.path),
  },
  {
    label: "Generated lockfile (`package-lock.json`)",
    why: "Emitted by npm from `package.json`; nobody wrote it.",
    match: entry => entry.path === "package-lock.json",
  },
  {
    label: "Generated dim-sum catalog index",
    why: "Generated record of the bundled images, not hand-written code.",
    match: entry => entry.path === "src/renderer/assets/dim-sum/release-catalog.json",
  },
  {
    label: "Upstream licence text (`LICENSE`)",
    why: "Verbatim MPL-2.0 boilerplate, not written for this project.",
    match: entry => entry.path === "LICENSE",
  },
];

const project = [
  { label: "Main process (`src/main`)", match: path => path.startsWith("src/main/") },
  { label: "Preload bridge (`src/preload`)", match: path => path.startsWith("src/preload/") },
  { label: "Shared contracts (`src/shared`)", match: path => path.startsWith("src/shared/") },
  { label: "Renderer styles (`src/renderer`)", match: path => path.startsWith("src/renderer/") && extension(path) === "css" },
  { label: "Renderer markup (`src/renderer`)", match: path => path.startsWith("src/renderer/") && extension(path) === "html" },
  { label: "Renderer source (`src/renderer`)", match: path => path.startsWith("src/renderer/") },
  { label: "End-to-end tests (`tests/e2e`)", match: path => path.startsWith("tests/e2e/") },
  { label: "Test fixtures (`tests/fixtures`)", match: path => path.startsWith("tests/fixtures/") },
  { label: "Unit and integration tests (`tests`)", match: path => path.startsWith("tests/") },
  { label: "Build and verification scripts (`scripts`)", match: path => path.startsWith("scripts/") },
  { label: "Site styles (`site`)", match: path => path.startsWith("site/") && extension(path) === "css" },
  { label: "Site markup (`site`)", match: path => path.startsWith("site/") && extension(path) === "html" },
  { label: "Site data (`site`)", match: path => path.startsWith("site/") && extension(path) === "json" },
  { label: "Site source (`site`)", match: path => path.startsWith("site/") },
  { label: "Feature documentation (`docs`)", match: path => path.startsWith("docs/") },
  { label: "CI workflow (`.github`)", match: path => path.startsWith(".github/") },
  { label: "Repository documentation (root Markdown)", match: path => root(path) && extension(path) === "md" },
  { label: "Project configuration (repository root)", match: path => root(path) },
];
const catchAll = { label: "Other tracked files (uncategorised)", match: () => true };

const bucketOf = entry => {
  const held = heldOut.find(bucket => bucket.match(entry));
  if (held) return { bucket: held, counted: !binaryPaths.has(entry.path) && entry.mode !== "160000" };
  return { bucket: project.find(bucket => bucket.match(entry.path)) ?? catchAll, counted: true };
};

const placed = entries.map(entry => ({ ...entry, ...bucketOf(entry) }));
const readable = placed.filter(entry => entry.counted);

const blobs = await (async () => {
  const raw = await git(["cat-file", "--batch"], `${readable.map(entry => entry.oid).join("\n")}\n`);
  const texts = [];
  let offset = 0;
  for (const entry of readable) {
    const newline = raw.indexOf(0x0a, offset);
    const header = raw.subarray(offset, newline).toString("utf8");
    const [oid, type, size] = header.split(" ");
    if (oid !== entry.oid || type !== "blob") throw new Error(`Unexpected cat-file header for ${entry.path}: ${header}`);
    const start = newline + 1;
    texts.push(raw.subarray(start, start + Number(size)).toString("utf8"));
    offset = start + Number(size) + 1;
  }
  return texts;
})();

// A file's final newline terminates its last line; splitting on "\n" would invent an extra empty one
// that `git blame` does not report, and the attribution assertion below would then never balance.
const countLines = text => {
  if (text.length === 0) return { lines: 0, nonBlank: 0 };
  const lines = text.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return { lines: lines.length, nonBlank: lines.filter(line => line.trim() !== "").length };
};

const measured = new Map(readable.map((entry, index) => [entry.path, countLines(blobs[index])]));

const summarise = rows => ({
  files: rows.length,
  lines: rows.reduce((total, entry) => total + (measured.get(entry.path)?.lines ?? 0), 0),
  nonBlank: rows.reduce((total, entry) => total + (measured.get(entry.path)?.nonBlank ?? 0), 0),
});

const tally = (definitions, alwaysShow) =>
  definitions
    .map(definition => ({
      label: definition.label,
      why: definition.why,
      ...summarise(placed.filter(entry => entry.bucket === definition)),
      paths: placed.filter(entry => entry.bucket === definition).map(entry => entry.path),
    }))
    .filter(row => row.files > 0 || alwaysShow.includes(row.label));

const projectRows = tally([...project, catchAll], [catchAll.label]);
const heldOutRows = tally(heldOut, []);
const projectTotal = summarise(placed.filter(entry => !heldOut.includes(entry.bucket)));
const grandTotal = summarise(placed);

// Per surviving line, never a sum of added lines from the log: churn is not authorship, and a line
// written then deleted belongs to nobody.
const blameHeader = /^([0-9a-f]{40,64}) \d+ \d+/;
const perFile = await mapLimited(readable, 8, async entry => {
  const output = await gitText(["blame", "--porcelain", rev, "--", entry.path]);
  const counts = new Map();
  for (const line of output.split("\n")) {
    const match = blameHeader.exec(line);
    if (match) counts.set(match[1], (counts.get(match[1]) ?? 0) + 1);
  }
  return counts;
});

const linesByCommit = new Map();
for (const counts of perFile) {
  for (const [sha, count] of counts) linesByCommit.set(sha, (linesByCommit.get(sha) ?? 0) + count);
}

const automation = /\[bot\]|\bbot\b|\bclaude\b|\bcodex\b|\bcopilot\b|\bcursor\b|\bdevin\b|\bopencode\b|@anthropic\.com|@openai\.com/i;
const shas = [...linesByCommit.keys()];
const metadata = await gitText(["log", "--no-walk", "--stdin", "--format=%H%x00%an%x00%ae%x00%B%x01"], `${shas.join("\n")}\n`);
const agentCommits = new Set();
let describedCommits = 0;
for (const record of metadata.split("\u0001")) {
  const trimmed = record.replace(/^\n+/, "");
  if (trimmed.length === 0) continue;
  describedCommits += 1;
  const [sha, name, email, body = ""] = trimmed.split("\u0000");
  const coAuthors = [...body.matchAll(/^co-authored-by:[ \t]*(.+)$/gim)].map(match => match[1]);
  if (automation.test(`${name} <${email}>`) || coAuthors.some(coAuthor => automation.test(coAuthor))) agentCommits.add(sha);
}
if (describedCommits !== shas.length) {
  throw new Error(`Resolved ${describedCommits} of ${shas.length} blamed commits; attribution would be incomplete.`);
}

let agentLines = 0;
let humanLines = 0;
for (const [sha, count] of linesByCommit) {
  if (agentCommits.has(sha)) agentLines += count;
  else humanLines += count;
}

if (agentLines + humanLines !== grandTotal.lines) {
  throw new Error(
    `Counter is broken: git blame attributed ${agentLines + humanLines} lines but the files measure ${grandTotal.lines}. ` +
      "Publishing two numbers that do not add up would misrepresent both.",
  );
}

const share = count => (grandTotal.lines === 0 ? "0.0" : ((count / grandTotal.lines) * 100).toFixed(1));
// Grouped by hand rather than through toLocaleString, so a runner's ICU build cannot change a published figure.
const number = value => String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

if (wantsJson) {
  console.log(
    JSON.stringify(
      {
        commit: rev,
        commitShort: shortRev,
        command: "node scripts/count-lines.mjs",
        project: { rows: projectRows, total: projectTotal },
        heldOut: { rows: heldOutRows },
        grandTotal,
        attribution: {
          rule: automation.source,
          agentCommits: agentCommits.size,
          commits: shas.length,
          agentLines,
          humanLines,
          total: agentLines + humanLines,
        },
      },
      null,
      2,
    ),
  );
} else {
  const lines = [
    "## Lines of code",
    "",
    `Counted at \`${rev}\` (\`${shortRev}\`) by \`npm run count:lines\`. Files come from \`git ls-tree\` at that commit, so ignored and untracked paths (\`node_modules\`, \`dist\`, \`release\`) cannot enter the figures.`,
    "",
    "### Project code",
    "",
    "| Area | Files | Lines | Non-blank |",
    "| --- | ---: | ---: | ---: |",
    ...projectRows.map(row => `| ${row.label} | ${number(row.files)} | ${number(row.lines)} | ${number(row.nonBlank)} |`),
    `| **Project total** | **${number(projectTotal.files)}** | **${number(projectTotal.lines)}** | **${number(projectTotal.nonBlank)}** |`,
    "",
    "### Counted, but held out of the project total",
    "",
    "| Area | Files | Lines | Non-blank | Why it is held out |",
    "| --- | ---: | ---: | ---: | --- |",
    ...heldOutRows.map(row => `| ${row.label} | ${number(row.files)} | ${number(row.lines)} | ${number(row.nonBlank)} | ${row.why} |`),
    `| **Grand total (everything tracked)** | **${number(grandTotal.files)}** | **${number(grandTotal.lines)}** | **${number(grandTotal.nonBlank)}** | |`,
    "",
    "### Who wrote the surviving lines",
    "",
    "| Author | Lines | Share |",
    "| --- | ---: | ---: |",
    `| Agents | ${number(agentLines)} | ${share(agentLines)}% |`,
    `| People | ${number(humanLines)} | ${share(humanLines)}% |`,
    `| **Total** | **${number(agentLines + humanLines)}** | **${share(agentLines + humanLines)}%** |`,
    "",
    `Each line is attributed with \`git blame\` to the commit that last touched it, so deleted work counts for nobody. A commit is agent-written when its author identity, or a \`Co-Authored-By:\` trailer in its message, matches \`${automation.source}\`; ${number(agentCommits.size)} of the ${number(shas.length)} commits still surviving in this tree match.`,
  ];
  console.log(lines.join("\n"));
}
