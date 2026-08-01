import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ComposeDraft } from "../src/shared/contracts";
import { AttachmentAuthorization, inspectEditorExecutable } from "../src/main/local-file-authorization";

const draft = (attachments: string[], id = "draft-1"): ComposeDraft => ({
  id,
  accountId: "account-1",
  to: ["friend@example.test"],
  cc: [],
  bcc: [],
  subject: "Attachment authorization",
  text: "The renderer cannot choose arbitrary files.",
  attachments,
});

describe("local file authorization", () => {
  it("allows a native-dialog selection and rejects a different local file", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "material-email-files-"));
    const approvedPath = path.join(directory, "approved.txt");
    const arbitraryPath = path.join(directory, "arbitrary.txt");
    await writeFile(approvedPath, "approved", "utf8");
    await writeFile(arbitraryPath, "not approved", "utf8");
    const authorization = new AttachmentAuthorization();
    const [selected] = await authorization.approveDialogSelection([approvedPath]);

    await expect(authorization.authorizeDraft(draft([selected!]), undefined, { requireExistingFiles: true })).resolves.toEqual(
      expect.objectContaining({ attachments: [selected] }),
    );
    await expect(authorization.authorizeDraft(draft([arbitraryPath]), undefined, { requireExistingFiles: true })).rejects.toThrow(
      "not approved",
    );
  });

  it("keeps matching persisted-draft approvals across restart without authorizing another draft", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "material-email-files-"));
    const approvedPath = path.join(directory, "persisted.txt");
    await writeFile(approvedPath, "persisted", "utf8");
    const authorizationAfterRestart = new AttachmentAuthorization();
    const persisted = draft([approvedPath]);

    await expect(
      authorizationAfterRestart.authorizeDraft(draft([approvedPath]), persisted, { requireExistingFiles: true }),
    ).resolves.toEqual(expect.objectContaining({ attachments: [approvedPath] }));
    await expect(
      authorizationAfterRestart.authorizeDraft(draft([approvedPath], "different-draft"), persisted, { requireExistingFiles: true }),
    ).rejects.toThrow("not approved");
  });

  it("requires an actual PE-style .exe file before an editor can be approved", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "material-email-editor-"));
    const executable = path.join(directory, "editor.exe");
    const fakeExecutable = path.join(directory, "fake.exe");
    const wrongExtension = path.join(directory, "editor.txt");
    await writeFile(executable, Buffer.from("MZfixture"));
    await writeFile(fakeExecutable, "not an executable", "utf8");
    await writeFile(wrongExtension, Buffer.from("MZfixture"));

    await expect(inspectEditorExecutable(executable)).resolves.toBe(executable);
    await expect(inspectEditorExecutable(fakeExecutable)).rejects.toThrow("signature");
    await expect(inspectEditorExecutable(wrongExtension)).rejects.toThrow(".exe");
  });
});
