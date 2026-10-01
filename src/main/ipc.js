/**
 * ipc.js -- recovered from the packaged main bundle (electron-vite output, out/main/main.js).
 * IPC channel table + trusted-sender wrapper.
 * Provenance: see docs/SOURCE-RECOVERY.md. Slices are byte-identical to the bundle except for
 * the documented symbol renames (esbuild added $1/$2 suffixes to duplicate names).
 */
import { ipcMain, app, BrowserWindow, shell } from "electron";
import { validateCleanRequest, validateSoftwareUninstallRequest, validateStartupDisableRequest, validateAggressiveCleanRequest, validateId } from "./request-validators.js";
const IPC_CHANNELS = Object.freeze({
  scan: "jingjie:scan",
  cancelScan: "jingjie:cancel-scan",
  clean: "jingjie:clean",
  cancelCleanup: "jingjie:cleanup:cancel",
  getCleanupProgress: "jingjie:cleanup:progress:get",
  cleanupProgress: "jingjie:cleanup:progress",
  history: "jingjie:history",
  quarantine: "jingjie:quarantine",
  restore: "jingjie:restore",
  softwareList: "jingjie:software:list",
  softwareUninstall: "jingjie:software:uninstall",
  softwareHistory: "jingjie:software:history",
  softwareUninstallProgress: "jingjie:software:uninstall:progress",
  startupList: "jingjie:startup:list",
  startupDisable: "jingjie:startup:disable",
  startupRestore: "jingjie:startup:restore",
  startupHistory: "jingjie:startup:history",
  aggressiveScan: "jingjie:aggressive:scan",
  aggressiveCancelScan: "jingjie:aggressive:scan:cancel",
  aggressiveClean: "jingjie:aggressive:clean",
  aggressiveCancelCleanup: "jingjie:aggressive:cleanup:cancel",
  aggressiveProgress: "jingjie:aggressive:progress:get",
  aggressiveProgressEvent: "jingjie:aggressive:progress",
  aggressiveHistory: "jingjie:aggressive:history",
  planBuild: "jingjie:plan:build",
  planPreview: "jingjie:plan:preview",
  planExecute: "jingjie:plan:execute",
  planRetry: "jingjie:plan:retry",
  planCancel: "jingjie:plan:cancel",
  planHistory: "jingjie:plan:history",
  planProgressEvent: "jingjie:plan:progress"
});
/**
 * Plan requests are { planId, selection, confirm?, irreversibleAck? }. Selection entries are
 * ids only -- never a path, a command or a package name (the same rule every other channel
 * follows). Shapes are checked here, the confirmation itself is enforced by the controllers.
 */
function validatePlanSelectionRequest(value, { requireSelection } = { requireSelection: true }) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid-plan-request");
  const keys = Object.keys(value).sort().join(",");
  const allowed = { "planId,selection": true, "confirm,planId,selection": true, "confirm,irreversibleAck,planId,selection": true };
  if (!allowed[keys]) throw new Error("invalid-plan-request");
  if (typeof value.planId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.planId)) {
    throw new Error("invalid-plan-request");
  }
  if (requireSelection && (!Array.isArray(value.selection) || value.selection.length === 0 || value.selection.length > 20000)) {
    throw new Error("invalid-plan-request");
  }
  if (!Array.isArray(value.selection)) throw new Error("invalid-plan-request");
  if (!value.selection.every((entry) => typeof entry === "string" && entry.length > 0 && entry.length <= 260)) throw new Error("invalid-plan-request");
  if (new Set(value.selection).size !== value.selection.length) throw new Error("invalid-plan-request");
  return {
    planId: value.planId,
    selection: [...value.selection],
    confirm: value.confirm === true,
    irreversibleAck: value.irreversibleAck === true
  };
}
function registerIpcHandlers(services, isTrustedSender) {
  const { cleanerController, softwareController, startupController, aggressiveController, planController } = services;
  const trusted = (handler) => ((event, ...args) => {
    if (!isTrustedSender(event)) throw new Error("untrusted-renderer");
    return handler(event, ...args);
  });
  ipcMain.handle(IPC_CHANNELS.scan, trusted(() => cleanerController.scan()));
  ipcMain.handle(IPC_CHANNELS.cancelScan, trusted(() => cleanerController.cancelScan()));
  ipcMain.handle(IPC_CHANNELS.clean, trusted((_event, value) => cleanerController.clean(validateCleanRequest(value))));
  ipcMain.handle(IPC_CHANNELS.cancelCleanup, trusted(() => cleanerController.cancelCleanup()));
  ipcMain.handle(IPC_CHANNELS.getCleanupProgress, trusted(() => cleanerController.getCleanupProgress()));
  ipcMain.handle(IPC_CHANNELS.history, trusted(() => cleanerController.getHistory()));
  ipcMain.handle(IPC_CHANNELS.quarantine, trusted(() => cleanerController.listQuarantine()));
  ipcMain.handle(IPC_CHANNELS.restore, trusted((_event, value) => cleanerController.restoreQuarantine(validateId(value))));
  ipcMain.handle(IPC_CHANNELS.softwareList, trusted(() => softwareController.inventory()));
  ipcMain.handle(IPC_CHANNELS.softwareUninstall, trusted((_event, value) => softwareController.uninstall(validateSoftwareUninstallRequest(value))));
  ipcMain.handle(IPC_CHANNELS.softwareHistory, trusted(() => softwareController.history()));
  ipcMain.handle(IPC_CHANNELS.startupList, trusted(() => startupController.inventory()));
  ipcMain.handle(IPC_CHANNELS.startupDisable, trusted((_event, value) => startupController.disable(validateStartupDisableRequest(value))));
  ipcMain.handle(IPC_CHANNELS.startupRestore, trusted((_event, value) => startupController.restore(validateId(value))));
  ipcMain.handle(IPC_CHANNELS.startupHistory, trusted(() => startupController.history()));
  if (aggressiveController) {
    ipcMain.handle(IPC_CHANNELS.aggressiveScan, trusted(() => aggressiveController.scan()));
    ipcMain.handle(IPC_CHANNELS.aggressiveCancelScan, trusted(() => aggressiveController.cancelScan()));
    ipcMain.handle(IPC_CHANNELS.aggressiveClean, trusted((_event, value) => aggressiveController.clean(validateAggressiveCleanRequest(value))));
    ipcMain.handle(IPC_CHANNELS.aggressiveCancelCleanup, trusted(() => aggressiveController.cancelCleanup()));
    ipcMain.handle(IPC_CHANNELS.aggressiveProgress, trusted(() => aggressiveController.getProgress()));
    ipcMain.handle(IPC_CHANNELS.aggressiveHistory, trusted(() => aggressiveController.getHistory()));
  }
  if (planController) {
    ipcMain.handle(IPC_CHANNELS.planBuild, trusted((_event, value) => planController.build(value ?? {})));
    ipcMain.handle(IPC_CHANNELS.planPreview, trusted((_event, value) => {
      const request = validatePlanSelectionRequest(value);
      return planController.preview(request.planId, request.selection);
    }));
    ipcMain.handle(IPC_CHANNELS.planExecute, trusted((_event, value) => {
      const request = validatePlanSelectionRequest(value);
      return planController.execute(request.planId, request.selection, { confirm: request.confirm, irreversibleAck: request.irreversibleAck });
    }));
    ipcMain.handle(IPC_CHANNELS.planRetry, trusted(() => planController.retry({})));
    ipcMain.handle(IPC_CHANNELS.planCancel, trusted(() => ({
      cleaner: cleanerController.cancelCleanup(),
      aggressive: aggressiveController?.cancelCleanup() ?? false
    })));
    ipcMain.handle(IPC_CHANNELS.planHistory, trusted(() => planController.history()));
    planController.onProgress?.((progress) => {
      for (const window of BrowserWindow.getAllWindows()) window.webContents.send(IPC_CHANNELS.planProgressEvent, progress);
    });
  }
}
function isTrustedRendererUrl(candidateValue, expectedValue) {
  try {
    const candidate = new URL(candidateValue);
    const expected = new URL(expectedValue);
    if (candidate.protocol !== expected.protocol) return false;
    if (expected.protocol === "file:") {
      return candidate.host.toLocaleLowerCase("en-US") === expected.host.toLocaleLowerCase("en-US") && decodeURIComponent(candidate.pathname).toLocaleLowerCase("en-US") === decodeURIComponent(expected.pathname).toLocaleLowerCase("en-US");
    }
    return candidate.origin === expected.origin;
  } catch {
    return false;
  }
}

export {
  IPC_CHANNELS,
  registerIpcHandlers,
  isTrustedRendererUrl
};
