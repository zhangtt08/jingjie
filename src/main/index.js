/**
 * index.js -- Electron bootstrap (recovered from the packaged main bundle, then rewired).
 *
 * The shipped bundle built every controller inline inside app.whenReady(). That logic now
 * lives in services.js (createServices) so the same objects can be driven from plain Node by
 * the Agent API (agent/) and by the tests -- one set of safety guards, no second implementation.
 * Provenance: docs/SOURCE-RECOVERY.md.
 */
import { app, BrowserWindow } from "electron";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createServices, buildEnvFromProcess } from "./services.js";
import { createWindow, getMainWindow, rendererFilePath } from "./window.js";
import { registerIpcHandlers, IPC_CHANNELS, isTrustedRendererUrl } from "./ipc.js";

const __dirname = import.meta.dirname;

/**
 * fs-helper is the native side that enforces the protected-root manifest while deleting.
 * Packaged: resources/fs-helper. Development: vendor/fs-helper (not committed -- see README),
 * overridable with JINGJIE_FS_HELPER. When it is missing the aggressive scan and every elevated
 * action fail closed with "fs-helper-missing" instead of quietly losing the guard.
 */
function resolveHelperPath(packaged, resourcesPath) {
  if (process.env.JINGJIE_FS_HELPER) return process.env.JINGJIE_FS_HELPER;
  if (packaged) return join(resourcesPath, "fs-helper", "JingJieFsHelper.exe");
  return join(__dirname, "../../vendor/fs-helper/JingJieFsHelper.exe");
}

function resolveProviderRoot(packaged, resourcesPath) {
  if (process.env.JINGJIE_PROVIDERS_DIR) return process.env.JINGJIE_PROVIDERS_DIR;
  // packaging copies scripts/providers -> resources/providers (package.json "build.extraResources")
  if (packaged) return join(resourcesPath, "providers");
  return join(__dirname, "../../scripts/providers");
}

app.whenReady().then(async () => {
  const packaged = app.isPackaged;
  const resourcesPath = process.resourcesPath;
  const helperPath = resolveHelperPath(packaged, resourcesPath);
  const providerRoot = resolveProviderRoot(packaged, resourcesPath);

  // SystemRoot/Program Files come from the native helper when it is present (it is the same
  // source of truth the delete session is anchored on); env is the documented fallback.
  let systemFolders = {
    windowsRoot: process.env.SystemRoot ?? process.env.WINDIR,
    programFiles: process.env.ProgramFiles,
    programFilesX86: process.env["ProgramFiles(x86)"]
  };
  try {
    const { NativeSecureFileOperations } = await import("./native-delete.js");
    systemFolders = await new NativeSecureFileOperations(helperPath).getSystemFolders();
  } catch {
    if (!systemFolders.windowsRoot) throw new Error("system-folders-unavailable");
  }

  const userProfile = app.getPath("home");
  const localAppData = join(userProfile, "AppData", "Local");
  const env = {
    ...buildEnvFromProcess(process.env),
    userProfile,
    localAppData,
    tempRoot: join(localAppData, "Temp"),
    windowsRoot: systemFolders.windowsRoot
  };

  const services = createServices({
    env,
    folders: {
      windowsRoot: env.windowsRoot,
      programFiles: systemFolders.programFiles,
      programFilesX86: systemFolders.programFilesX86,
      selfPath: app.getPath("exe")
    },
    dataRoot: app.getPath("userData"),
    providerRoot,
    helperPath
  });

  const devRendererUrl = !packaged ? process.env.ELECTRON_RENDERER_URL : void 0;
  const expectedRendererUrl = () => devRendererUrl ?? pathToFileURL(rendererFilePath()).href;
  const isTrustedSender = (event) => {
    const main = getMainWindow();
    return main !== void 0 && event.sender === main.webContents && event.senderFrame !== null
      && isTrustedRendererUrl(event.senderFrame.url, expectedRendererUrl());
  };
  const openWindow = () => createWindow({ packaged, resourcesPath, rendererUrl: devRendererUrl, isTrustedSender });

  openWindow();
  registerIpcHandlers(services, isTrustedSender);

  services.cleanerController.onProgress((progress) => {
    const main = getMainWindow();
    if (main && !main.isDestroyed()) main.webContents.send(IPC_CHANNELS.cleanupProgress, progress);
  });
  services.aggressiveController.onProgress((progress) => {
    const main = getMainWindow();
    if (main && !main.isDestroyed()) main.webContents.send(IPC_CHANNELS.aggressiveProgressEvent, progress);
  });
  services.softwareController.onProgress((progress) => {
    const main = getMainWindow();
    if (main && !main.isDestroyed()) main.webContents.send(IPC_CHANNELS.softwareUninstallProgress, progress);
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) openWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
