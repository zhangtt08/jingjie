/**
 * aggressive-rules.js -- recovered from the packaged main bundle (electron-vite output, out/main/main.js).
 * rebuildable cache catalogue (fixed roots + discovered browser profiles).
 * Provenance: see docs/SOURCE-RECOVERY.md. Slices are byte-identical to the bundle except for
 * the documented symbol renames (esbuild added $1/$2 suffixes to duplicate names).
 */
import { win32, join, dirname, resolve, isAbsolute, parse, relative, basename } from "node:path";
import { lstat, realpath, readFile, mkdir, open, rm, rename, rmdir, unlink, copyFile, chmod, utimes, opendir, access, readdir, stat } from "node:fs/promises";
import { isDirectory, physicalPathIsProtected } from "./protected-roots.js";
async function profileDirectories(root) {
  if (!await isDirectory(root)) return [];
  const entries = await readdir(root, { withFileTypes: true });
  return entries.filter((entry) => entry.isDirectory() && /^(Default|Guest Profile|Profile \d+)$/i.test(entry.name)).map((entry) => ({ id: entry.name.toLocaleLowerCase("en-US").replace(/[^a-z0-9]+/g, "-"), root: win32.join(root, entry.name) }));
}
function browserCacheDefinitions(productId, productLabel, profileId, profileRoot) {
  const retained = "保留书签、历史、Cookie、密码、扩展、网站数据和会话";
  const definitions = [
    { id: `${profileId}-web-cache`, categoryId: "application-cache", label: `${productLabel} 网页缓存`, root: win32.join(profileRoot, "Cache", "Cache_Data"), impact: "网页首次重开时会重新下载部分资源", preservationSummary: retained },
    { id: `${profileId}-code-cache`, categoryId: "application-cache", label: `${productLabel} 代码缓存`, root: win32.join(profileRoot, "Code Cache"), impact: "网页脚本首次运行时会重新编译", preservationSummary: retained },
    { id: `${profileId}-gpu-cache`, categoryId: "application-cache", label: `${productLabel} 图形缓存`, root: win32.join(profileRoot, "GPUCache"), impact: "页面首次显示时会重建图形缓存", preservationSummary: retained }
  ];
  return definitions.map((definition) => ({ ...definition, id: `${productId}-${definition.id}` }));
}
function fixedDefinitions(env) {
  const roaming = win32.join(env.userProfile, "AppData", "Roaming");
  const keepApp = "保留账户、设置、插件、项目、存档、登录信息和数据库";
  return [
    { id: "directx-shader", categoryId: "system-cache", label: "DirectX 着色器缓存", root: win32.join(env.localAppData, "D3DSCache"), impact: "游戏或视频应用首次启动时可能短暂重新编译", preservationSummary: "保留显卡驱动、视频组件和显示设置" },
    { id: "nvidia-dx-cache", categoryId: "system-cache", label: "NVIDIA DirectX 缓存", root: win32.join(env.localAppData, "NVIDIA", "DXCache"), impact: "图形应用首次启动时可能短暂重新编译", preservationSummary: "保留 NVIDIA 驱动、配置和游戏资料" },
    { id: "nvidia-gl-cache", categoryId: "system-cache", label: "NVIDIA OpenGL 缓存", root: win32.join(env.localAppData, "NVIDIA", "GLCache"), impact: "OpenGL 应用首次启动时可能短暂重新编译", preservationSummary: "保留 NVIDIA 驱动、配置和游戏资料" },
    { id: "amd-dx-cache", categoryId: "system-cache", label: "AMD 着色器缓存", root: win32.join(env.localAppData, "AMD", "DxCache"), impact: "图形应用首次启动时可能短暂重新编译", preservationSummary: "保留 AMD 驱动、配置和游戏资料" },
    { id: "intel-shader-cache", categoryId: "system-cache", label: "Intel 着色器缓存", root: win32.join(env.localAppData, "Intel", "ShaderCache"), impact: "图形应用首次启动时可能短暂重新编译", preservationSummary: "保留 Intel 驱动、配置和媒体组件" },
    { id: "explorer-visual-cache", categoryId: "system-cache", label: "缩略图与图标缓存", root: win32.join(env.localAppData, "Microsoft", "Windows", "Explorer"), impact: "资源管理器会逐步重建缩略图和图标", preservationSummary: "保留文件、文件夹、桌面布局和资源管理器设置", fileNamePattern: /^(thumbcache|iconcache).*\.db$/i },
    { id: "crash-dumps", categoryId: "application-cache", label: "旧崩溃转储", root: win32.join(env.localAppData, "CrashDumps"), minAgeHours: 24, impact: "删除旧故障诊断副本", preservationSummary: keepApp },
    { id: "wer-archive", categoryId: "system-cache", label: "Windows 错误报告归档", root: win32.join(env.localAppData, "Microsoft", "Windows", "WER", "ReportArchive"), minAgeHours: 24, impact: "删除已经归档的故障诊断报告", preservationSummary: "保留 Windows 日志、恢复能力和当前错误队列" },
    { id: "discord-code-cache", categoryId: "application-cache", label: "Discord 代码缓存", root: win32.join(roaming, "discord", "Code Cache"), impact: "Discord 首次重开时会重建代码缓存", preservationSummary: keepApp },
    { id: "discord-gpu-cache", categoryId: "application-cache", label: "Discord 图形缓存", root: win32.join(roaming, "discord", "GPUCache"), impact: "Discord 首次重开时会重建图形缓存", preservationSummary: keepApp },
    { id: "slack-code-cache", categoryId: "application-cache", label: "Slack 代码缓存", root: win32.join(roaming, "Slack", "Code Cache"), impact: "Slack 首次重开时会重建代码缓存", preservationSummary: keepApp },
    { id: "slack-gpu-cache", categoryId: "application-cache", label: "Slack 图形缓存", root: win32.join(roaming, "Slack", "GPUCache"), impact: "Slack 首次重开时会重建图形缓存", preservationSummary: keepApp },
    { id: "vscode-code-cache", categoryId: "application-cache", label: "Visual Studio Code 代码缓存", root: win32.join(roaming, "Code", "Code Cache"), impact: "编辑器首次重开时会重建代码缓存", preservationSummary: keepApp },
    { id: "vscode-gpu-cache", categoryId: "application-cache", label: "Visual Studio Code 图形缓存", root: win32.join(roaming, "Code", "GPUCache"), impact: "编辑器首次重开时会重建图形缓存", preservationSummary: keepApp },
    { id: "npm-cache", categoryId: "developer-cache", label: "npm 下载缓存", root: win32.join(env.localAppData, "npm-cache", "_cacache"), impact: "以后安装相同包时需要重新下载", preservationSummary: "保留全局工具、项目和已安装依赖" },
    { id: "pip-cache", categoryId: "developer-cache", label: "pip 下载缓存", root: win32.join(env.localAppData, "pip", "Cache"), impact: "以后安装相同包时需要重新下载", preservationSummary: "保留 Python 环境、项目和已安装包" },
    { id: "nuget-v3-cache", categoryId: "developer-cache", label: "NuGet 下载索引缓存", root: win32.join(env.localAppData, "NuGet", "v3-cache"), impact: "以后还原依赖时需要重新下载索引", preservationSummary: "保留全局包、项目和已安装工具" },
    { id: "nuget-scratch", categoryId: "developer-cache", label: "NuGet 临时缓存", root: win32.join(env.localAppData, "NuGet", "Scratch"), minAgeHours: 24, impact: "删除旧的临时下载文件", preservationSummary: "保留全局包、项目和已安装工具" }
  ];
}
async function discoverAggressiveRules(env, protectedRootsArg) {
  const definitions = fixedDefinitions(env);
  const browserProducts = [
    { id: "chrome", label: "Chrome", root: win32.join(env.localAppData, "Google", "Chrome", "User Data") },
    { id: "edge", label: "Edge", root: win32.join(env.localAppData, "Microsoft", "Edge", "User Data") }
  ];
  for (const product of browserProducts) {
    for (const profile of await profileDirectories(product.root)) {
      definitions.push(...browserCacheDefinitions(product.id, product.label, profile.id, profile.root));
    }
  }
  const firefoxProfiles = win32.join(env.localAppData, "Mozilla", "Firefox", "Profiles");
  if (await isDirectory(firefoxProfiles)) {
    for (const entry of await readdir(firefoxProfiles, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      definitions.push({
        id: `firefox-${entry.name.toLocaleLowerCase("en-US").replace(/[^a-z0-9]+/g, "-")}-cache`,
        categoryId: "application-cache",
        label: "Firefox 网页缓存",
        root: win32.join(firefoxProfiles, entry.name, "cache2"),
        impact: "网页首次重开时会重新下载部分资源",
        preservationSummary: "保留书签、历史、Cookie、密码、扩展、网站数据和会话"
      });
    }
  }
  const rules = [];
  for (const definition of definitions) {
    if (!await isDirectory(definition.root)) continue;
    if (await physicalPathIsProtected(definition.root, protectedRootsArg)) continue;
    rules.push({
      ...definition,
      nativeRuleId: definition.id,
      anchorPath: env.userProfile,
      minAgeHours: definition.minAgeHours ?? 0
    });
  }
  return rules;
}

export {
  fixedDefinitions,
  discoverAggressiveRules,
  browserCacheDefinitions,
  profileDirectories
};
