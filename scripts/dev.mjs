import { spawn } from "node:child_process";
import { build } from "esbuild";

await build({
  entryPoints: ["src/main/index.ts"],
  outfile: "dist/main/index.cjs",
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  sourcemap: true,
  external: ["electron", "imapflow", "mailparser", "nodemailer", "sanitize-html", "zod"],
});
await build({
  entryPoints: ["src/preload/index.ts"],
  outfile: "dist/main/preload.cjs",
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  sourcemap: true,
  external: ["electron"],
});

const vite = spawn("npx", ["vite", "--host", "127.0.0.1"], {
  stdio: "inherit",
  shell: process.platform === "win32",
});
const electron = spawn("npx", ["wait-on", "http://127.0.0.1:5173", "&&", "electron", "."], {
  stdio: "inherit",
  shell: true,
  env: { ...process.env, MATERIAL_EMAIL_DEV_URL: "http://127.0.0.1:5173" },
});

const stop = () => {
  vite.kill();
  electron.kill();
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);

