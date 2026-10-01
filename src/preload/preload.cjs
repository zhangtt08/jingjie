"use strict";
const electron = require("electron");
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
electron.contextBridge.exposeInMainWorld("jingjie", Object.freeze({
  getRuntimeInfo: () => Object.freeze({ platform: process.platform }),
  scan: () => electron.ipcRenderer.invoke(IPC_CHANNELS.scan),
  cancelScan: () => electron.ipcRenderer.invoke(IPC_CHANNELS.cancelScan),
  clean: (taskId, itemIds, { confirm = false } = {}) => electron.ipcRenderer.invoke(IPC_CHANNELS.clean, { taskId, itemIds, confirm }),
  cancelCleanup: () => electron.ipcRenderer.invoke(IPC_CHANNELS.cancelCleanup),
  getCleanupProgress: () => electron.ipcRenderer.invoke(IPC_CHANNELS.getCleanupProgress),
  onCleanupProgress: (listener) => {
    const handler = (_event, progress) => listener(progress);
    electron.ipcRenderer.on(IPC_CHANNELS.cleanupProgress, handler);
    return () => electron.ipcRenderer.removeListener(IPC_CHANNELS.cleanupProgress, handler);
  },
  getHistory: () => electron.ipcRenderer.invoke(IPC_CHANNELS.history),
  listQuarantine: () => electron.ipcRenderer.invoke(IPC_CHANNELS.quarantine),
  restoreQuarantine: (id) => electron.ipcRenderer.invoke(IPC_CHANNELS.restore, id),
  listSoftware: () => electron.ipcRenderer.invoke(IPC_CHANNELS.softwareList),
  uninstallSoftware: (taskId, itemIds, { confirm = false } = {}) => electron.ipcRenderer.invoke(IPC_CHANNELS.softwareUninstall, { taskId, itemIds, confirm }),
  getSoftwareHistory: () => electron.ipcRenderer.invoke(IPC_CHANNELS.softwareHistory),
  onSoftwareUninstallProgress: (listener) => {
    const handler = (_event, progress) => listener(progress);
    electron.ipcRenderer.on(IPC_CHANNELS.softwareUninstallProgress, handler);
    return () => electron.ipcRenderer.removeListener(IPC_CHANNELS.softwareUninstallProgress, handler);
  },
  listStartupItems: () => electron.ipcRenderer.invoke(IPC_CHANNELS.startupList),
  disableStartupItems: (taskId, itemIds, { confirm = false } = {}) => electron.ipcRenderer.invoke(IPC_CHANNELS.startupDisable, { taskId, itemIds, confirm }),
  restoreStartupItem: (id) => electron.ipcRenderer.invoke(IPC_CHANNELS.startupRestore, id),
  getStartupHistory: () => electron.ipcRenderer.invoke(IPC_CHANNELS.startupHistory),
  scanAggressive: () => electron.ipcRenderer.invoke(IPC_CHANNELS.aggressiveScan),
  cancelAggressiveScan: () => electron.ipcRenderer.invoke(IPC_CHANNELS.aggressiveCancelScan),
  cleanAggressive: (taskId, itemIds, { confirm = false, irreversibleAck = false } = {}) => electron.ipcRenderer.invoke(IPC_CHANNELS.aggressiveClean, { taskId, itemIds, confirm, irreversibleAck }),
  cancelAggressiveCleanup: () => electron.ipcRenderer.invoke(IPC_CHANNELS.aggressiveCancelCleanup),
  getAggressiveProgress: () => electron.ipcRenderer.invoke(IPC_CHANNELS.aggressiveProgress),
  onAggressiveProgress: (listener) => {
    const handler = (_event, progress) => listener(progress);
    electron.ipcRenderer.on(IPC_CHANNELS.aggressiveProgressEvent, handler);
    return () => electron.ipcRenderer.removeListener(IPC_CHANNELS.aggressiveProgressEvent, handler);
  },
  getAggressiveHistory: () => electron.ipcRenderer.invoke(IPC_CHANNELS.aggressiveHistory),
  buildPlan: (options) => electron.ipcRenderer.invoke(IPC_CHANNELS.planBuild, options ?? {}),
  previewPlan: (planId, selection) => electron.ipcRenderer.invoke(IPC_CHANNELS.planPreview, { planId, selection }),
  executePlan: (planId, selection, { confirm = false, irreversibleAck = false } = {}) =>
    electron.ipcRenderer.invoke(IPC_CHANNELS.planExecute, { planId, selection, confirm, irreversibleAck }),
  retryPlan: () => electron.ipcRenderer.invoke(IPC_CHANNELS.planRetry),
  cancelPlan: () => electron.ipcRenderer.invoke(IPC_CHANNELS.planCancel),
  getPlanHistory: () => electron.ipcRenderer.invoke(IPC_CHANNELS.planHistory),
  onPlanProgress: (listener) => {
    const handler = (_event, progress) => listener(progress);
    electron.ipcRenderer.on(IPC_CHANNELS.planProgressEvent, handler);
    return () => electron.ipcRenderer.removeListener(IPC_CHANNELS.planProgressEvent, handler);
  }
}));

electron.contextBridge.exposeInMainWorld("jingjieWindow", Object.freeze({
  minimize: () => electron.ipcRenderer.invoke("win:minimize"),
  toggleMaximize: () => electron.ipcRenderer.invoke("win:toggle-maximize"),
  close: () => electron.ipcRenderer.invoke("win:close"),
  isMaximized: () => electron.ipcRenderer.invoke("win:is-maximized"),
  onMaximizedChange: (cb) => {
    const h = (_e, v) => cb(v);
    electron.ipcRenderer.on("win:maximized", h);
    return () => electron.ipcRenderer.removeListener("win:maximized", h);
  },
}));
