import { open, realpath, stat } from "node:fs/promises";
import path from "node:path";
import type { ComposeDraft } from "../shared/contracts.js";
import { nativePathSchema } from "./ipc-validation.js";

const pathKey = (value: string): string => path.win32.normalize(value).toLocaleLowerCase("en-US");

const inspectRegularFile = async (value: string): Promise<{ displayPath: string; keys: string[] }> => {
  const lexicalPath = path.win32.normalize(nativePathSchema.parse(value));
  const resolvedPath = await realpath(lexicalPath);
  const information = await stat(resolvedPath);
  if (!information.isFile()) throw new Error("The selected path is not a regular file.");
  return { displayPath: resolvedPath, keys: [...new Set([pathKey(lexicalPath), pathKey(resolvedPath)])] };
};

const knownPathKeys = async (value: string): Promise<string[]> => {
  const lexicalPath = path.win32.normalize(nativePathSchema.parse(value));
  try {
    const resolvedPath = await realpath(lexicalPath);
    return [...new Set([pathKey(lexicalPath), pathKey(resolvedPath)])];
  } catch {
    return [pathKey(lexicalPath)];
  }
};

export class AttachmentAuthorization {
  readonly #dialogApprovedKeys = new Set<string>();

  async approveDialogSelection(paths: readonly string[]): Promise<string[]> {
    if (paths.length > 100) throw new Error("A message can contain at most 100 attachments.");
    const approved: string[] = [];
    for (const candidate of paths) {
      const inspected = await inspectRegularFile(candidate);
      for (const key of inspected.keys) this.#dialogApprovedKeys.add(key);
      approved.push(inspected.displayPath);
    }
    return approved;
  }

  async authorizeDraft(
    draft: ComposeDraft,
    persistedDraft: ComposeDraft | undefined,
    options: { requireExistingFiles: boolean },
  ): Promise<ComposeDraft> {
    if (!draft.attachments.length) return structuredClone(draft);

    const persistedKeys = new Set<string>();
    if (persistedDraft && draft.id && persistedDraft.id === draft.id && persistedDraft.accountId === draft.accountId) {
      for (const persistedPath of persistedDraft.attachments) {
        for (const key of await knownPathKeys(persistedPath)) persistedKeys.add(key);
      }
    }

    const attachments: string[] = [];
    for (const candidate of draft.attachments) {
      const lexicalPath = path.win32.normalize(nativePathSchema.parse(candidate));
      const knownKeys = await knownPathKeys(lexicalPath);
      if (!knownKeys.some(key => this.#dialogApprovedKeys.has(key) || persistedKeys.has(key))) {
        throw new Error("An attachment was not approved by the native file picker. Choose the file again before saving or sending.");
      }
      if (options.requireExistingFiles) attachments.push((await inspectRegularFile(lexicalPath)).displayPath);
      else attachments.push(lexicalPath);
    }
    return { ...draft, attachments };
  }
}

export const inspectEditorExecutable = async (value: string): Promise<string> => {
  const inspected = await inspectRegularFile(value);
  if (path.win32.extname(inspected.displayPath).toLocaleLowerCase("en-US") !== ".exe") {
    throw new Error("External editors must be Windows executable (.exe) files selected in the native file picker.");
  }
  const handle = await open(inspected.displayPath, "r");
  try {
    const signature = Buffer.alloc(2);
    const { bytesRead } = await handle.read(signature, 0, signature.length, 0);
    if (bytesRead !== signature.length || signature.toString("ascii") !== "MZ") {
      throw new Error("The selected editor does not contain a valid Windows executable signature.");
    }
  } finally {
    await handle.close();
  }
  return inspected.displayPath;
};

export const sameWindowsPath = (left: string, right: string): boolean => pathKey(left) === pathKey(right);
