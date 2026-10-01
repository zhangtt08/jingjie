/**
 * window-options.js -- recovered from the packaged main bundle (electron-vite output, out/main/main.js).
 * window creation options (preload path, icon path, webPreferences).
 * Provenance: see docs/SOURCE-RECOVERY.md. Slices are byte-identical to the bundle except for
 * the documented symbol renames (esbuild added $1/$2 suffixes to duplicate names).
 */
import { win32, join, dirname, resolve, isAbsolute, parse, relative, basename } from "node:path";
function getPreloadPath(mainDirectory) {
  return join(mainDirectory, "../preload/preload.cjs");
}
function getWindowIconPath(mainDirectory, packaged, resourcesPath) {
  // packaged: extraResources puts the brand folder at resources/brand (see package.json "build")
  // dev: the repository keeps the same PNG under assets/brand
  return packaged ? join(resourcesPath, "brand", "icon.png") : join(mainDirectory, "../../assets/brand/icon.png");
}
function getWindowWebPreferences(preload) {
  return {
    preload,
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false
  };
}

export {
  getPreloadPath,
  getWindowIconPath,
  getWindowWebPreferences
};
