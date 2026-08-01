import path from "node:path";
import { writeFile } from "node:fs/promises";
import { app, BrowserWindow, ipcMain, Notification, session, shell, type IpcMainInvokeEvent } from "electron";
import type { z } from "zod";
import { AppService } from "./app-service.js";
import { nativeNotificationCopy } from "./native-notification-copy.js";
import type {
  CalendarEventPatch,
  ContactPatch,
  CreateCalendarEventInput,
  CreateContactInput,
  CreateMailingListInput,
  CreateTaskInput,
  MailingListPatch,
  TaskPatch,
  TransactionFilter,
} from "../shared/contracts.js";
import { ipcPayloadSchemas, parseIpcArgs } from "./ipc-validation.js";
import {
  assertTrustedRendererClaim,
  isTrustedRendererFrameUrl,
  resolveRendererLoadTarget,
  type RendererLoadTarget,
} from "./renderer-trust.js";

let mainWindow: BrowserWindow | null = null;
let activeTrustedRendererUrl: string | null = null;
let service: AppService;
const pendingMailto: string[] = [];
const isCiSmoke = process.argv.includes("--ci-smoke");
const isHeadlessHarness = process.env.MATERIAL_EMAIL_HEADLESS === "1";
const ciSmokeOutput = process.argv.find(argument => argument.startsWith("--ci-smoke-output="))?.slice("--ci-smoke-output=".length);
const isolatedUserData = process.env.MATERIAL_EMAIL_USER_DATA_DIR;
if (isolatedUserData) app.setPath("userData", path.resolve(isolatedUserData));

const rendererPath = path.join(__dirname, "../renderer/index.html");
const preloadPath = path.join(__dirname, "preload.cjs");

const registerIpc = (trustedRendererUrl: string): void => {
  const assertTrustedSender = (event: IpcMainInvokeEvent): void => {
    const senderFrame = event.senderFrame;
    assertTrustedRendererClaim({
      hasMainWindow: mainWindow !== null,
      senderMatchesMainWindow: mainWindow !== null && event.sender === mainWindow.webContents,
      senderFrameIsMainFrame: senderFrame !== null && senderFrame === event.sender.mainFrame,
      senderFrameUrl: senderFrame?.url ?? "",
      trustedUrl: trustedRendererUrl,
    });
  };

  const handleTrusted = <Args extends unknown[]>(channel: string, listener: (...args: Args) => unknown): void => {
    ipcMain.handle(channel, (event, ...args: unknown[]) => {
      assertTrustedSender(event);
      return listener(...(args as Args));
    });
  };

  const handleValidated = <Schema extends z.ZodType>(
    channel: string,
    schema: Schema,
    listener: (payload: z.output<Schema>) => unknown,
  ): void => {
    handleTrusted(channel, (...args: unknown[]) => listener(parseIpcArgs(channel, schema, args)));
  };

  handleValidated("app:bootstrap", ipcPayloadSchemas.none, () => service.bootstrap());
  handleValidated("dialog:attachments", ipcPayloadSchemas.none, () => service.chooseAttachments());
  handleValidated("account:create-demo", ipcPayloadSchemas.none, () => service.createDemoAccount());
  handleValidated("account:discover", ipcPayloadSchemas.accountDiscover, ([email]) => service.discoverAccount(email));
  handleValidated("account:test", ipcPayloadSchemas.accountDraft, ([draft]) => service.testAccount(draft));
  handleValidated("account:add", ipcPayloadSchemas.accountDraft, ([draft]) => service.addAccount(draft));
  handleValidated("account:remove", ipcPayloadSchemas.accountId, ([accountId]) => service.removeAccount(accountId));
  handleValidated("mail:sync", ipcPayloadSchemas.accountId, ([accountId]) => service.syncAccount(accountId));
  handleValidated("mail:folders", ipcPayloadSchemas.accountId, ([accountId]) => service.listFolders(accountId));
  handleValidated("mail:messages", ipcPayloadSchemas.accountFolder, ([accountId, folderPath]) => service.listMessages(accountId, folderPath));
  handleValidated("mail:message", ipcPayloadSchemas.accountFolderMessage, ([accountId, folderPath, uid]) =>
    service.getMessage(accountId, folderPath, uid),
  );
  handleValidated("mail:save-attachment", ipcPayloadSchemas.saveAttachment, ([accountId, folderPath, uid, index]) =>
    service.saveAttachment(accountId, folderPath, uid, index),
  );
  handleValidated("mail:save-all-attachments", ipcPayloadSchemas.accountFolderMessage, ([accountId, folderPath, uid]) =>
    service.saveAllAttachments(accountId, folderPath, uid),
  );
  handleValidated("mail:flags", ipcPayloadSchemas.messageFlags, ([accountId, folderPath, uid, patch]) =>
    service.setMessageFlags(accountId, folderPath, uid, patch),
  );
  handleValidated("mail:move", ipcPayloadSchemas.moveMessage, ([accountId, folderPath, uid, destination]) =>
    service.moveMessage(accountId, folderPath, uid, destination),
  );
  handleValidated("mail:send", ipcPayloadSchemas.composeDraft, ([draft]) => service.sendMessage(draft));
  handleValidated("mail:save-draft", ipcPayloadSchemas.composeDraft, ([draft]) => service.saveDraft(draft));
  handleValidated("mail:drafts", ipcPayloadSchemas.accountId, ([accountId]) => service.listDrafts(accountId));
  handleValidated("mail:draft", ipcPayloadSchemas.accountItem, ([accountId, draftId]) => service.getDraft(accountId, draftId));
  handleValidated("mail:delete-draft", ipcPayloadSchemas.accountItem, ([accountId, draftId]) => service.deleteDraft(accountId, draftId));
  handleValidated("mail:pending-operations", ipcPayloadSchemas.accountId, ([accountId]) => service.listPendingOperations(accountId));
  handleValidated("mail:retry-pending-operation", ipcPayloadSchemas.accountItem, ([accountId, operationId]) =>
    service.retryPendingOperation(accountId, operationId),
  );
  handleValidated("mail:discard-pending-operation", ipcPayloadSchemas.accountItem, ([accountId, operationId]) =>
    service.discardPendingOperation(accountId, operationId),
  );
  handleValidated("mail:outbox", ipcPayloadSchemas.accountId, ([accountId]) => service.listOutbox(accountId));
  handleValidated("mail:cancel-outbox", ipcPayloadSchemas.accountItem, ([accountId, outboxId]) => service.cancelOutbox(accountId, outboxId));
  handleValidated("mail:retry-outbox", ipcPayloadSchemas.accountItem, ([accountId, outboxId]) => service.retryOutbox(accountId, outboxId));
  handleValidated("preferences:save", ipcPayloadSchemas.preferences, ([patch]) => service.savePreferences(patch));
  handleValidated("notifications:read", ipcPayloadSchemas.notificationRead, ([id, read]) => service.markNotificationRead(id, read));
  handleValidated("notifications:clear", ipcPayloadSchemas.none, () => service.clearNotifications());
  handleValidated("notifications:native", ipcPayloadSchemas.nativeNotification, async ([kind]) => {
    if (!(await service.getPreferences()).nativeNotificationsEnabled || !Notification.isSupported()) return false;
    const title = "Material Email";
    const prefs = await service.getPreferences();
    const body = nativeNotificationCopy(kind, prefs);
    new Notification({ title, body, silent: true }).show();
    return true;
  });
  handleValidated("history:restore", ipcPayloadSchemas.historyId, ([id]) => service.restoreHistory(id));
  handleValidated("history:list-local", ipcPayloadSchemas.none, () => service.listLocalRevisions());
  handleValidated("history:restore-local", ipcPayloadSchemas.revisionHash, ([hash]) => service.restoreLocalRevision(hash));
  handleTrusted("pim:contacts:list", () => service.listContacts());
  handleTrusted("pim:contacts:search", (query: string) => service.searchContacts(query));
  handleTrusted("pim:contacts:create", (input: CreateContactInput) => service.createContact(input));
  handleTrusted("pim:contacts:update", (uid: string, patch: ContactPatch) => service.updateContact(uid, patch));
  handleTrusted("pim:contacts:delete", (uid: string) => service.deleteContact(uid));
  handleTrusted("pim:contacts:restore", (uid: string, transactionId?: string) => service.restoreContact(uid, transactionId));
  handleTrusted("pim:vcard:import", () => service.importVCard());
  handleTrusted("pim:vcard:export", (contactUids?: string[], mailingListUids?: string[]) => service.exportVCard(contactUids, mailingListUids));
  handleTrusted("pim:mailing-lists:list", () => service.listMailingLists());
  handleTrusted("pim:mailing-lists:members", (uid: string) => service.listMailingListMembers(uid));
  handleTrusted("pim:mailing-lists:create", (input: CreateMailingListInput) => service.createMailingList(input));
  handleTrusted("pim:mailing-lists:update", (uid: string, patch: MailingListPatch) => service.updateMailingList(uid, patch));
  handleTrusted("pim:mailing-lists:delete", (uid: string) => service.deleteMailingList(uid));
  handleTrusted("pim:mailing-lists:restore", (uid: string, transactionId?: string) => service.restoreMailingList(uid, transactionId));
  handleTrusted("pim:events:list", () => service.listCalendarEvents());
  handleTrusted("pim:events:create", (input: CreateCalendarEventInput) => service.createCalendarEvent(input));
  handleTrusted("pim:events:update", (uid: string, patch: CalendarEventPatch) => service.updateCalendarEvent(uid, patch));
  handleTrusted("pim:events:delete", (uid: string) => service.deleteCalendarEvent(uid));
  handleTrusted("pim:events:restore", (uid: string, transactionId?: string) => service.restoreCalendarEvent(uid, transactionId));
  handleTrusted("pim:tasks:list", () => service.listTasks());
  handleTrusted("pim:tasks:create", (input: CreateTaskInput) => service.createTask(input));
  handleTrusted("pim:tasks:update", (uid: string, patch: TaskPatch) => service.updateTask(uid, patch));
  handleTrusted("pim:tasks:delete", (uid: string) => service.deleteTask(uid));
  handleTrusted("pim:tasks:restore", (uid: string, transactionId?: string) => service.restoreTask(uid, transactionId));
  handleTrusted("pim:transactions:list", (filter?: TransactionFilter) => service.listPimTransactions(filter));
  handleValidated("data:export", ipcPayloadSchemas.exportData, ([kind, content, suggestedName]) =>
    service.exportData(kind, content, suggestedName),
  );
  handleValidated("editor:detect", ipcPayloadSchemas.none, () => service.detectEditors());
  handleValidated("editor:open", ipcPayloadSchemas.editorOpen, ([editorPath]) => service.openExternalEditor(editorPath));
  handleValidated("window:minimize", ipcPayloadSchemas.none, () => mainWindow?.minimize());
  handleValidated("window:maximize", ipcPayloadSchemas.none, () => {
    if (!mainWindow) return false;
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
    return mainWindow.isMaximized();
  });
  handleValidated("window:close", ipcPayloadSchemas.none, () => mainWindow?.close());
};

const deliverMailto = (commandLine: string[]): void => {
  for (const argument of commandLine) {
    if (!/^mailto:/i.test(argument)) continue;
    if (
      mainWindow
      && activeTrustedRendererUrl
      && !mainWindow.webContents.isLoading()
      && isTrustedRendererFrameUrl(mainWindow.webContents.getURL(), activeTrustedRendererUrl)
    ) mainWindow.webContents.send("app:mailto", argument);
    else pendingMailto.push(argument);
  }
};

const createWindow = async (rendererTarget: RendererLoadTarget): Promise<void> => {
  activeTrustedRendererUrl = rendererTarget.trustedUrl;
  mainWindow = new BrowserWindow({
    width: 1500,
    height: 940,
    minWidth: 760,
    minHeight: 560,
    show: false,
    backgroundColor: "#fff7ff",
    title: "Material Email",
    autoHideMenuBar: true,
    titleBarStyle: "hidden",
    titleBarOverlay: { color: "#f8f2fa", symbolColor: "#1d1b20", height: 48 },
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: true,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", event => event.preventDefault());
  mainWindow.webContents.on("will-redirect", event => event.preventDefault());
  mainWindow.once("ready-to-show", () => {
    if (!isCiSmoke && !isHeadlessHarness) mainWindow?.show();
  });
  mainWindow.webContents.once("did-finish-load", async () => {
    if (
      mainWindow
      && activeTrustedRendererUrl
      && isTrustedRendererFrameUrl(mainWindow.webContents.getURL(), activeTrustedRendererUrl)
    ) {
      for (const url of pendingMailto.splice(0)) mainWindow.webContents.send("app:mailto", url);
    }
    if (isCiSmoke) {
      const result = await service.bootstrap();
      if (ciSmokeOutput) {
        await writeFile(
          ciSmokeOutput,
          `${JSON.stringify({ ok: true, version: result.version, releaseDate: result.release.releaseDate, codeName: result.release.codeName })}\n`,
          "utf8",
        );
      }
      app.exit(0);
    }
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
    activeTrustedRendererUrl = null;
  });

  if (rendererTarget.kind === "url") await mainWindow.loadURL(rendererTarget.trustedUrl);
  else await mainWindow.loadFile(rendererTarget.filePath);
};

app.setAppUserModelId("com.dingdingprojects.materialemail");

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();
else {
  app.on("second-instance", (_event, commandLine) => {
    deliverMailto(commandLine);
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
  deliverMailto(process.argv);
}

if (hasSingleInstanceLock) app.whenReady().then(async () => {
  service = new AppService(app.getPath("userData"));
  const rendererTarget = resolveRendererLoadTarget({
    isPackaged: app.isPackaged,
    rendererPath,
    developmentUrl: process.env.MATERIAL_EMAIL_DEV_URL,
  });
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  registerIpc(rendererTarget.trustedUrl);
  await createWindow(rendererTarget);
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow(rendererTarget);
  });
});

app.on("window-all-closed", () => app.quit());
