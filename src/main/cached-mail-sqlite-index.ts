import { createHash } from "node:crypto";
import { rmSync } from "node:fs";
import { createRequire } from "node:module";
import type { DatabaseSync as DatabaseSyncType, StatementSync } from "node:sqlite";
import {
  createCachedMailIndex,
  searchCachedMailIndex,
  type CachedMailIndex,
  type CachedMailIndexDocument,
  type CachedMailIndexSource,
} from "../shared/cached-mail-index.js";
import type { CachedMailSearchQuery, CachedMailSearchResult } from "../shared/contracts.js";

/**
 * Bump this whenever the on-disk table shape changes. A file written by an older (or newer,
 * hypothetically downgraded) build never has its rows read back — `#loadOrRebuild` treats a
 * mismatch exactly like a missing index and rebuilds cleanly from `source`, which stays the only
 * source of truth this cache ever has.
 */
export const CACHED_MAIL_SQLITE_SCHEMA_VERSION = 1;

const META_SCHEMA_VERSION_KEY = "schema_version";
const META_FINGERPRINT_KEY = "source_fingerprint";
const META_DOCUMENT_LIMIT_REACHED_KEY = "document_limit_reached";

type DatabaseSyncCtor = new (path: string) => DatabaseSyncType;

/**
 * `node:sqlite` is loaded once, lazily, through `createRequire` rather than a static ESM import
 * so that a Node build without it (or with the feature disabled) never fails to load this module
 * — every caller falls back to the pure in-memory index automatically. Node's `require` cache
 * keeps this to one real load per process.
 */
const loadDatabaseSyncCtor = (): DatabaseSyncCtor | null => {
  try {
    const require = createRequire(import.meta.url);
    // eslint-disable-next-line @typescript-eslint/no-var-requires -- optional builtin, guarded.
    const sqliteModule = require("node:sqlite") as { DatabaseSync: DatabaseSyncCtor };
    return sqliteModule.DatabaseSync ?? null;
  } catch {
    return null;
  }
};

const databaseSyncCtor = loadDatabaseSyncCtor();

/** True only when this Node build actually exposes `node:sqlite`. Exposed for tests/diagnostics. */
export const isCachedMailSqliteIndexSupported = (): boolean => databaseSyncCtor !== null;

interface StoredMeta {
  schemaVersion: number;
  fingerprint: string;
  documentLimitReached: boolean;
}

const fingerprintSource = (source: CachedMailIndexSource): string =>
  createHash("sha256").update(JSON.stringify(source)).digest("hex");

/**
 * A derived, rebuildable SQLite cache of the cached-mail search index. It is never a source of
 * truth: every query still runs through the exact same `searchCachedMailIndex` matcher this
 * module reuses unmodified, so results are identical regardless of whether the documents came
 * from SQLite or were just computed from `source`. On any doubt at all — the file is missing,
 * an older/foreign schema, corrupt bytes, or simply out of date relative to `source` — this class
 * rebuilds from `source` and, only if even that cannot be persisted, hands `search` nothing so it
 * falls back to computing the answer directly. A caller of `search` can never observe a failure.
 */
export class CachedMailSqliteIndex {
  readonly #filePath: string;

  constructor(filePath: string) {
    this.#filePath = filePath;
  }

  /** Answers a cached-mail search, using the on-disk index when it can be trusted or rebuilt. */
  search(source: CachedMailIndexSource, query: CachedMailSearchQuery): CachedMailSearchResult {
    const index = this.#resolveIndex(source);
    return searchCachedMailIndex(index ?? createCachedMailIndex(source), query);
  }

  /**
   * Unconditionally rebuilds the on-disk index from `source`. Intended for an explicit
   * startup/on-demand refresh; `search` already rebuilds lazily on its own, so calling this is
   * an optimization, never a correctness requirement. Returns whether the rebuild was persisted.
   */
  rebuild(source: CachedMailIndexSource): boolean {
    if (!databaseSyncCtor) return false;
    try {
      const db = new databaseSyncCtor(this.#filePath);
      try {
        this.#writeIndex(db, createCachedMailIndex(source), fingerprintSource(source));
        return true;
      } finally {
        db.close();
      }
    } catch {
      this.#resetFile();
      return false;
    }
  }

  #resolveIndex(source: CachedMailIndexSource): CachedMailIndex | null {
    if (!databaseSyncCtor) return null;
    try {
      return this.#loadOrRebuild(source);
    } catch {
      return this.#recoverAfterCorruption(source);
    }
  }

  #loadOrRebuild(source: CachedMailIndexSource): CachedMailIndex {
    // databaseSyncCtor is checked by every caller of this private method before it is invoked.
    const db = new databaseSyncCtor!(this.#filePath);
    try {
      const fingerprint = fingerprintSource(source);
      const meta = this.#readMeta(db);
      if (meta && meta.schemaVersion === CACHED_MAIL_SQLITE_SCHEMA_VERSION && meta.fingerprint === fingerprint) {
        return this.#readDocuments(db, meta.documentLimitReached);
      }
      const fresh = createCachedMailIndex(source);
      this.#writeIndex(db, fresh, fingerprint);
      return fresh;
    } finally {
      db.close();
    }
  }

  /**
   * A genuinely corrupt file (not merely an empty or older-schema one, both handled quietly
   * inside `#loadOrRebuild`) throws past that method's own recovery. This is the single retry:
   * delete whatever is on disk and attempt exactly one clean rebuild on a fresh file. If that
   * also fails — a read-only data directory, for instance — give up for this call and let
   * `search` fall back to computing the answer purely in memory.
   */
  #recoverAfterCorruption(source: CachedMailIndexSource): CachedMailIndex | null {
    this.#resetFile();
    try {
      return this.#loadOrRebuild(source);
    } catch {
      return null;
    }
  }

  #resetFile(): void {
    for (const suffix of ["", "-wal", "-shm", "-journal"]) {
      try {
        rmSync(`${this.#filePath}${suffix}`, { force: true });
      } catch {
        // Best-effort only; a failed delete still falls through to the in-memory search path.
      }
    }
  }

  #readMeta(db: DatabaseSyncType): StoredMeta | null {
    try {
      const rows = db.prepare("SELECT key, value FROM schema_meta").all() as Array<{ key: string; value: string }>;
      const values = new Map(rows.map(row => [row.key, row.value]));
      const schemaVersionRaw = values.get(META_SCHEMA_VERSION_KEY);
      const fingerprint = values.get(META_FINGERPRINT_KEY);
      const documentLimitReachedRaw = values.get(META_DOCUMENT_LIMIT_REACHED_KEY);
      if (schemaVersionRaw === undefined || fingerprint === undefined || documentLimitReachedRaw === undefined) return null;
      const schemaVersion = Number(schemaVersionRaw);
      if (!Number.isInteger(schemaVersion)) return null;
      return { schemaVersion, fingerprint, documentLimitReached: documentLimitReachedRaw === "1" };
    } catch {
      // No `schema_meta` table at all is the ordinary shape of a brand-new, never-built file —
      // not corruption. `#loadOrRebuild` treats this identically to a stale/older-schema file.
      return null;
    }
  }

  #readDocuments(db: DatabaseSyncType, documentLimitReached: boolean): CachedMailIndex {
    const rows = db.prepare("SELECT payload FROM documents ORDER BY position ASC").all() as Array<{ payload: string }>;
    const documents = rows.map(row => JSON.parse(row.payload) as CachedMailIndexDocument);
    return { documents, documentLimitReached };
  }

  #writeIndex(db: DatabaseSyncType, index: CachedMailIndex, fingerprint: string): void {
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec("DROP TABLE IF EXISTS documents");
      db.exec("DROP TABLE IF EXISTS schema_meta");
      db.exec("CREATE TABLE schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
      db.exec(
        "CREATE TABLE documents (" +
          "position INTEGER PRIMARY KEY, " +
          "message_id TEXT NOT NULL, " +
          "account_id TEXT NOT NULL, " +
          "folder_path TEXT NOT NULL, " +
          "payload TEXT NOT NULL)",
      );
      db.exec("CREATE INDEX idx_documents_account ON documents(account_id)");
      db.exec("CREATE INDEX idx_documents_folder ON documents(folder_path)");
      const insertDocument: StatementSync = db.prepare(
        "INSERT INTO documents (position, message_id, account_id, folder_path, payload) VALUES (?, ?, ?, ?, ?)",
      );
      index.documents.forEach((document, position) => {
        insertDocument.run(position, document.message.id, document.message.accountId, document.message.folderPath, JSON.stringify(document));
      });
      const insertMeta: StatementSync = db.prepare("INSERT INTO schema_meta (key, value) VALUES (?, ?)");
      insertMeta.run(META_SCHEMA_VERSION_KEY, String(CACHED_MAIL_SQLITE_SCHEMA_VERSION));
      insertMeta.run(META_FINGERPRINT_KEY, fingerprint);
      insertMeta.run(META_DOCUMENT_LIMIT_REACHED_KEY, index.documentLimitReached ? "1" : "0");
      db.exec("COMMIT");
    } catch (error) {
      try {
        db.exec("ROLLBACK");
      } catch {
        // The original error is what matters; a failed rollback on an already-broken connection
        // is expected and does not change the outcome the caller sees.
      }
      throw error;
    }
  }
}
