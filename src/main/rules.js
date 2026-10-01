/**
 * rules.js -- recovered from the packaged main bundle (electron-vite output, out/main/main.js).
 * default cleanup rule catalogue.
 * Provenance: see docs/SOURCE-RECOVERY.md. Slices are byte-identical to the bundle except for
 * the documented symbol renames (esbuild added $1/$2 suffixes to duplicate names).
 */
import { win32, join, dirname, resolve, isAbsolute, parse, relative, basename } from "node:path";
function createDefaultRules(env) {
  return [
    { id: "user-temp", label: "用户临时文件", root: env.tempRoot, mode: "delete", minAgeHours: 24, enabled: true },
    { id: "windows-temp", label: "系统临时文件", root: win32.join(env.windowsRoot, "Temp"), mode: "delete", minAgeHours: 24, enabled: true },
    { id: "crash-dumps", label: "崩溃转储", root: win32.join(env.localAppData, "CrashDumps"), mode: "quarantine", minAgeHours: 24, enabled: true },
    { id: "wer-reports", label: "Windows 错误报告", root: win32.join(env.localAppData, "Microsoft", "Windows", "WER", "ReportArchive"), mode: "quarantine", minAgeHours: 24, enabled: true },
    { id: "edge-cache", label: "Edge 缓存", root: win32.join(env.localAppData, "Microsoft", "Edge", "User Data", "Default", "Cache", "Cache_Data"), mode: "delete", minAgeHours: 24, enabled: true },
    { id: "chrome-cache", label: "Chrome 缓存", root: win32.join(env.localAppData, "Google", "Chrome", "User Data", "Default", "Cache", "Cache_Data"), mode: "delete", minAgeHours: 24, enabled: true }
  ];
}

export {
  createDefaultRules
};
