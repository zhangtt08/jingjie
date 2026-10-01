/**
 * window.js -- recovered from the packaged main bundle (out/main/main.js) and cleaned up.
 * the single app window (frameless, sandboxed, navigation locked).
 *
 * Recovery notes (see docs/SOURCE-REVIEW.md / docs/SECURITY-REVIEW.md):
 * - The shipped bundle stashed the window on `globalThis.__jjWin` and registered the
 *   frameless-window IPC (minimize / toggle-maximize / close / is-maximized) inside
 *   createWindow() behind a `globalThis.__jjWinHandlers` flag. Those handlers had NO
 *   sender check, unlike every `jingjie:*` channel. They now live at module scope and
 *   go through the same trusted-sender test (SECURITY-REVIEW.md finding S-01).
 * - `mainWindow` is module state again; the shipped code also assigned it from the
 *   bootstrap, which cannot work once the bundle is split into modules.
 */
import { ipcMain, BrowserWindow, shell } from "electron";
import { join } from "node:path";
import { getPreloadPath, getWindowIconPath, getWindowWebPreferences } from "./window-options.js";

const __dirname = import.meta.dirname;

let mainWindow;

export function getMainWindow() {
  return mainWindow;
}

export function rendererFilePath() {
  return join(__dirname, "../renderer/index.html");
}

let windowControlsRegistered = false;
function registerWindowControls(isTrustedSender) {
  if (windowControlsRegistered) return;
  windowControlsRegistered = true;
  const trusted = (handler) => ((event, ...args) => {
    if (!isTrustedSender(event)) throw new Error("untrusted-renderer");
    return handler(event, ...args);
  });
  ipcMain.handle("win:minimize", trusted(() => mainWindow?.minimize()));
  ipcMain.handle("win:toggle-maximize", trusted(() => {
    if (!mainWindow) return false;
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
      return false;
    }
    mainWindow.maximize();
    return true;
  }));
  ipcMain.handle("win:close", trusted(() => mainWindow?.close()));
  ipcMain.handle("win:is-maximized", trusted(() => Boolean(mainWindow?.isMaximized())));
}

/**
 * @param {object} options
 * @param {boolean} options.packaged          app.isPackaged
 * @param {string}  options.resourcesPath     process.resourcesPath
 * @param {string}  [options.rendererUrl]     dev-server URL, when there is one
 * @param {(event: import("electron").IpcMainInvokeEvent) => boolean} [options.isTrustedSender]
 */
export function createWindow({ packaged = false, resourcesPath = process.resourcesPath, rendererUrl, isTrustedSender = () => true } = {}) {
  const window = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 960,
    minHeight: 680,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: "#eef1f5",
    title: "净界",
    frame: false,
    icon: getWindowIconPath(__dirname, packaged, resourcesPath),
    webPreferences: getWindowWebPreferences(getPreloadPath(__dirname))
  });
  mainWindow = window;
  window.once("ready-to-show", () => window.show());
  window.on("maximize", () => window.webContents.send("win:maximized", true));
  window.on("unmaximize", () => window.webContents.send("win:maximized", false));
  registerWindowControls((event) => event.sender === window.webContents && isTrustedSender(event));
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) void shell.openExternal(url);
    return { action: "deny" };
  });
  if (rendererUrl) void window.loadURL(rendererUrl);
  else void window.loadFile(rendererFilePath());
  window.on("closed", () => {
    if (mainWindow === window) mainWindow = void 0;
  });
  return window;
}
