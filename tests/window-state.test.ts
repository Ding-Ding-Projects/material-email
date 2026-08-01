import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  WINDOW_DEFAULT_HEIGHT,
  WINDOW_DEFAULT_WIDTH,
  WindowStateStore,
  defaultWindowState,
  parseWindowState,
  resolveWindowBounds,
} from "../src/main/window-state";

describe("Windows window-state persistence", () => {
  it("validates the bounded schema and rejects incomplete coordinates", () => {
    expect(parseWindowState({
      schemaVersion: 1,
      bounds: { x: -320, y: 40, width: 1_280, height: 760 },
      maximized: true,
    })).toEqual({
      schemaVersion: 1,
      bounds: { x: -320, y: 40, width: 1_280, height: 760 },
      maximized: true,
    });
    expect(() => parseWindowState({ schemaVersion: 1, bounds: { x: 2, width: 900, height: 700 }, maximized: false })).toThrow(
      /coordinates must be stored together/i,
    );
    expect(() => parseWindowState({ schemaVersion: 1, bounds: { width: 759, height: 700 }, maximized: false })).toThrow(
      /supported range/i,
    );
  });

  it("centres an off-screen window and clamps oversized saved bounds to the current display", () => {
    expect(resolveWindowBounds({
      schemaVersion: 1,
      bounds: { x: 50_000, y: 50_000, width: 2_500, height: 1_500 },
      maximized: false,
    }, [{ x: 0, y: 0, width: 1_920, height: 1_040 }])).toEqual({ x: 0, y: 0, width: 1_920, height: 1_040 });

    expect(resolveWindowBounds(defaultWindowState(), [{ x: 100, y: 50, width: 1_920, height: 1_080 }])).toEqual({
      x: 310,
      y: 120,
      width: WINDOW_DEFAULT_WIDTH,
      height: WINDOW_DEFAULT_HEIGHT,
    });
  });

  it("serializes saves, survives restart, and preserves a corrupt primary before replacement", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "material-email-window-state-"));
    const file = path.join(directory, "window-state.json");
    await writeFile(file, "{not-json", "utf8");
    const store = new WindowStateStore(file);
    expect(await store.read()).toEqual(defaultWindowState());

    await Promise.all([
      store.save({ schemaVersion: 1, bounds: { x: 10, y: 20, width: 900, height: 700 }, maximized: false }),
      store.save({ schemaVersion: 1, bounds: { x: 30, y: 40, width: 1_100, height: 800 }, maximized: true }),
    ]);
    await store.flush();

    const reopened = new WindowStateStore(file);
    expect(await reopened.read()).toEqual({
      schemaVersion: 1,
      bounds: { x: 30, y: 40, width: 1_100, height: 800 },
      maximized: true,
    });
    expect(JSON.parse(await readFile(file, "utf8"))).toMatchObject({ maximized: true });
    expect((await readdir(directory)).some(name => name.startsWith("window-state.json.invalid."))).toBe(true);
  });
});
