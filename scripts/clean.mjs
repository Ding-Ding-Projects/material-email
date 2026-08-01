import { rm } from "node:fs/promises";

for (const path of ["dist", "release", "coverage"]) {
  await rm(path, { recursive: true, force: true });
}

