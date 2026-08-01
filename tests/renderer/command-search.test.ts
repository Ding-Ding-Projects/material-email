import { describe, expect, it } from "vitest";
import { filterPaletteCommands } from "../../src/renderer/lib/command-search";

const commands = [
  { id: "settings", en: "Open Settings", yue: "開啟設定" },
  { id: "history", en: "Open History", yue: "開啟歷史記錄" },
  { id: "literal", en: "Open .* diagnostics", yue: "開啟 .* 診斷" },
] as const;

describe("command palette search", () => {
  it("treats plain-text input literally and ignores case by default", () => {
    expect(filterPaletteCommands(commands, { mode: "plain", pattern: "OPEN SETTINGS", flags: "i" }).map(item => item.id)).toEqual(["settings"]);
    expect(filterPaletteCommands(commands, { mode: "plain", pattern: ".*", flags: "i" }).map(item => item.id)).toEqual(["literal"]);
  });

  it("matches English and Cantonese command labels with the shared regex dialect", () => {
    expect(filterPaletteCommands(commands, { mode: "regex", pattern: "^(Open (Settings|History)|開啟設定)", flags: "iu" }).map(item => item.id)).toEqual(["settings", "history"]);
  });

  it("returns no executable result for invalid or risky patterns", () => {
    expect(filterPaletteCommands(commands, { mode: "regex", pattern: "(", flags: "i" })).toEqual([]);
    expect(filterPaletteCommands(commands, { mode: "regex", pattern: "(a+)+$", flags: "i" })).toEqual([]);
  });

  it("shows every command for the untouched empty plain-text model", () => {
    expect(filterPaletteCommands(commands, { mode: "plain", pattern: "", flags: "i" })).toEqual(commands);
  });
});
