import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  TAB_APPEARANCE_THEME_FORMAT,
  TAB_APPEARANCE_THEME_MAX_BYTES,
  TAB_APPEARANCE_THEME_VERSION,
  type TabAppearanceThemeDocument,
} from "../src/shared/tab-appearance-theme";

const mocks = vi.hoisted(() => ({
  showOpenDialog: vi.fn(),
  showSaveDialog: vi.fn(),
}));

vi.mock("electron", () => ({
  app: { getAppPath: () => process.cwd(), getVersion: () => "0.1.0-test" },
  dialog: { showOpenDialog: mocks.showOpenDialog, showSaveDialog: mocks.showSaveDialog },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(value, "utf8"),
    decryptString: (value: Buffer) => value.toString("utf8"),
  },
}));

import { AppService } from "../src/main/app-service";

const theme = (): TabAppearanceThemeDocument => ({
  format: TAB_APPEARANCE_THEME_FORMAT,
  version: TAB_APPEARANCE_THEME_VERSION,
  name: "Transfer fixture",
  tabStyles: { settings: { accent: "#336699", background: "#E2E8F0", foreground: "#1E293B", fontSize: 15, fontWeight: 650, radius: 12 } },
  presets: [{ id: "user-transfer", name: "Transfer preset", style: { accent: "#336699", radius: 12 } }],
});

describe("secure appearance-theme desktop transfer", () => {
  let directory = "";
  let service: AppService;

  beforeEach(async () => {
    vi.clearAllMocks();
    directory = await mkdtemp(path.join(os.tmpdir(), "material-email-appearance-theme-"));
    service = new AppService(directory);
  });

  afterEach(async () => {
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  it("exports a validated JSON theme through the native save dialog without exposing its path", async () => {
    const destination = path.join(directory, "calm-theme.json");
    mocks.showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: destination });

    await expect(service.exportTabAppearanceTheme(theme())).resolves.toEqual({ fileName: "calm-theme.json" });
    const written = JSON.parse(await readFile(destination, "utf8")) as Record<string, unknown>;
    expect(written).toEqual(theme());
    expect(JSON.stringify(written)).not.toMatch(/password|credential|message|account/iu);
    expect(mocks.showSaveDialog).toHaveBeenCalledWith(expect.objectContaining({ filters: [{ name: "Material Email appearance theme", extensions: ["json"] }] }));
  });

  it("imports only a bounded regular UTF-8 JSON file and returns a basename plus normalized allow-listed values", async () => {
    const source = path.join(directory, "calm-theme.json");
    await writeFile(source, JSON.stringify({ ...theme(), tabStyles: { settings: { accent: "#abcdef", radius: 10 } } }), "utf8");
    mocks.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [source] });

    await expect(service.importTabAppearanceTheme()).resolves.toEqual({
      fileName: "calm-theme.json",
      theme: { ...theme(), tabStyles: { settings: { accent: "#ABCDEF", radius: 10 } } },
    });
    expect(mocks.showOpenDialog).toHaveBeenCalledWith(expect.objectContaining({ properties: ["openFile"] }));
  });

  it("rejects secret-shaped unknown fields and files over the fixed byte limit", async () => {
    const invalid = path.join(directory, "invalid.json");
    await writeFile(invalid, JSON.stringify({ ...theme(), password: "not-allowed" }), "utf8");
    mocks.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [invalid] });
    await expect(service.importTabAppearanceTheme()).rejects.toThrow(/rejected.*supported top-level fields/iu);

    const oversized = path.join(directory, "oversized.json");
    await writeFile(oversized, "x".repeat(TAB_APPEARANCE_THEME_MAX_BYTES + 1), "utf8");
    mocks.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [oversized] });
    await expect(service.importTabAppearanceTheme()).rejects.toThrow(/1 through 262144 bytes/iu);
  });

  it("leaves local state alone when either desktop dialog is cancelled", async () => {
    mocks.showSaveDialog.mockResolvedValueOnce({ canceled: true });
    await expect(service.exportTabAppearanceTheme(theme())).resolves.toBeNull();
    mocks.showOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: [] });
    await expect(service.importTabAppearanceTheme()).resolves.toBeNull();
  });
});
