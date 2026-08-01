import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";

export const WINDOW_STATE_SCHEMA_VERSION = 1 as const;
export const WINDOW_MIN_WIDTH = 760;
export const WINDOW_MIN_HEIGHT = 560;
export const WINDOW_DEFAULT_WIDTH = 1_500;
export const WINDOW_DEFAULT_HEIGHT = 940;
const WINDOW_STATE_MAX_BYTES = 16 * 1024;

export interface WindowBounds {
  x?: number;
  y?: number;
  width: number;
  height: number;
}

export interface PersistedWindowState {
  schemaVersion: typeof WINDOW_STATE_SCHEMA_VERSION;
  bounds: WindowBounds;
  maximized: boolean;
}

export interface WindowWorkArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const defaultWindowState = (): PersistedWindowState => ({
  schemaVersion: WINDOW_STATE_SCHEMA_VERSION,
  bounds: { width: WINDOW_DEFAULT_WIDTH, height: WINDOW_DEFAULT_HEIGHT },
  maximized: false,
});

const finiteInteger = (value: unknown, minimum: number, maximum: number): number | undefined =>
  typeof value === "number" && Number.isInteger(value) && value >= minimum && value <= maximum ? value : undefined;

export const parseWindowState = (value: unknown): PersistedWindowState => {
  if (!value || typeof value !== "object") throw new Error("Window state must be an object.");
  const record = value as Record<string, unknown>;
  if (record.schemaVersion !== WINDOW_STATE_SCHEMA_VERSION || typeof record.maximized !== "boolean") {
    throw new Error("Window state has an unsupported schema.");
  }
  if (!record.bounds || typeof record.bounds !== "object") throw new Error("Window bounds are missing.");
  const bounds = record.bounds as Record<string, unknown>;
  const width = finiteInteger(bounds.width, WINDOW_MIN_WIDTH, 32_768);
  const height = finiteInteger(bounds.height, WINDOW_MIN_HEIGHT, 32_768);
  const x = bounds.x === undefined ? undefined : finiteInteger(bounds.x, -1_000_000, 1_000_000);
  const y = bounds.y === undefined ? undefined : finiteInteger(bounds.y, -1_000_000, 1_000_000);
  if (width === undefined || height === undefined || (bounds.x !== undefined && x === undefined) || (bounds.y !== undefined && y === undefined)) {
    throw new Error("Window bounds are outside the supported range.");
  }
  if ((x === undefined) !== (y === undefined)) throw new Error("Window coordinates must be stored together.");
  const positionedBounds = x === undefined ? {} : { x, y: y as number };
  return {
    schemaVersion: WINDOW_STATE_SCHEMA_VERSION,
    bounds: { ...positionedBounds, width, height },
    maximized: record.maximized,
  };
};

const overlapArea = (bounds: Required<WindowBounds>, area: WindowWorkArea): number => {
  const width = Math.max(0, Math.min(bounds.x + bounds.width, area.x + area.width) - Math.max(bounds.x, area.x));
  const height = Math.max(0, Math.min(bounds.y + bounds.height, area.y + area.height) - Math.max(bounds.y, area.y));
  return width * height;
};

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.max(minimum, Math.min(Math.max(minimum, maximum), value));

export const resolveWindowBounds = (state: PersistedWindowState, workAreas: readonly WindowWorkArea[]): Required<WindowBounds> => {
  const fallbackArea = workAreas[0] ?? { x: 0, y: 0, width: WINDOW_DEFAULT_WIDTH, height: WINDOW_DEFAULT_HEIGHT };
  const requested: Required<WindowBounds> = {
    x: state.bounds.x ?? fallbackArea.x + Math.round((fallbackArea.width - state.bounds.width) / 2),
    y: state.bounds.y ?? fallbackArea.y + Math.round((fallbackArea.height - state.bounds.height) / 2),
    width: state.bounds.width,
    height: state.bounds.height,
  };
  const target = workAreas
    .map(area => ({ area, overlap: overlapArea(requested, area) }))
    .sort((left, right) => right.overlap - left.overlap)[0];
  const area = target && target.overlap >= 64 * 64 ? target.area : fallbackArea;
  const width = clamp(requested.width, Math.min(WINDOW_MIN_WIDTH, area.width), area.width);
  const height = clamp(requested.height, Math.min(WINDOW_MIN_HEIGHT, area.height), area.height);
  const x = target && target.overlap >= 64 * 64
    ? clamp(requested.x, area.x, area.x + area.width - width)
    : area.x + Math.round((area.width - width) / 2);
  const y = target && target.overlap >= 64 * 64
    ? clamp(requested.y, area.y, area.y + area.height - height)
    : area.y + Math.round((area.height - height) / 2);
  return { x, y, width, height };
};

export class WindowStateStore {
  readonly #filePath: string;
  #queue: Promise<void> = Promise.resolve();
  #invalidPrimary = false;

  constructor(filePath: string) {
    this.#filePath = filePath;
  }

  async read(): Promise<PersistedWindowState> {
    await this.#queue;
    try {
      const metadata = await stat(this.#filePath);
      if (!metadata.isFile() || metadata.size > WINDOW_STATE_MAX_BYTES) throw new Error("Window state file is not a bounded regular file.");
      const parsed = parseWindowState(JSON.parse(await readFile(this.#filePath, "utf8")));
      this.#invalidPrimary = false;
      return parsed;
    } catch (error) {
      if (error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT") {
        this.#invalidPrimary = false;
      } else {
        this.#invalidPrimary = true;
      }
      return defaultWindowState();
    }
  }

  async save(value: PersistedWindowState): Promise<void> {
    const state = parseWindowState(value);
    const operation = this.#queue.then(async () => {
      await mkdir(path.dirname(this.#filePath), { recursive: true });
      if (this.#invalidPrimary) {
        await rename(this.#filePath, `${this.#filePath}.invalid.${Date.now()}`).catch(() => undefined);
      }
      const temporaryPath = `${this.#filePath}.${process.pid}.${Date.now()}.tmp`;
      await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
      await rename(temporaryPath, this.#filePath);
      this.#invalidPrimary = false;
    });
    this.#queue = operation.catch(() => undefined);
    await operation;
  }

  async flush(): Promise<void> {
    await this.#queue;
  }
}
