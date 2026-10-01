/**
 * startup-effects.js -- recovered from the packaged main bundle (electron-vite output, out/main/main.js).
 * honest impact wording per startup category (no invented seconds).
 * Provenance: see docs/SOURCE-RECOVERY.md. Slices are byte-identical to the bundle except for
 * the documented symbol renames (esbuild added $1/$2 suffixes to duplicate names).
 */
import { win32, join, dirname, resolve, isAbsolute, parse, relative, basename } from "node:path";
const EFFECTS = [
  {
    category: "security",
    confidence: "high",
    recommendation: "keep",
    evidenceLabel: "名称或发布者显示为安全防护组件",
    patterns: [/anti-?virus|antimalware|security|firewall|defender|endpoint|huorong|hipstray|sysdiag|火绒|杀毒|安全防护/i],
    disabledEffect: "登录后相关实时防护、状态提醒或安全检查可能不会自动启动。",
    manualUse: "手动打开主程序不一定能恢复所有后台防护组件。",
    recommendationReason: "安全防护依赖后台常驻，净界会继续保护此类启动项。"
  },
  {
    category: "device-helper",
    confidence: "high",
    recommendation: "keep",
    evidenceLabel: "名称或发布者显示为设备辅助组件",
    patterns: [/driver|graphics|display|audio|touchpad|keyboard|mouse|firmware|device|vpn|wireguard|input method|\bime\b|驱动|显卡|声卡|触控板|设备|输入法/i],
    disabledEffect: "登录后相关设备功能、快捷键、网络连接或状态托盘可能不可用。",
    manualUse: "手动打开工具可能恢复界面，但不保证驱动辅助与后台服务完整恢复。",
    recommendationReason: "设备与联网辅助组件对系统功能有直接影响，建议保留。"
  },
  {
    category: "messaging",
    confidence: "high",
    recommendation: "keep",
    evidenceLabel: "名称或可执行文件显示为通信程序",
    patterns: [/wechat|weixin|\bqq\b|telegram|discord|slack|teams|whatsapp|messenger|chat|message|imclient|聊天|消息|即时通信/i],
    disabledEffect: "开机登录后不会自动运行；在手动打开软件前，桌面消息提醒可能不可用。",
    manualUse: "手动打开软件后，聊天和消息功能通常可以正常使用。",
    recommendationReason: "如果你依赖实时消息提醒，建议保留；偶尔使用则可以关闭。"
  },
  {
    category: "cloud-sync",
    confidence: "high",
    recommendation: "keep",
    evidenceLabel: "名称或可执行文件显示为同步程序",
    patterns: [/onedrive|dropbox|icloud|cloud\s*(?:drive|sync)|drive\s*sync|sync|netdisk|网盘|云盘|同步|备份/i],
    disabledEffect: "开机后不会自动同步或备份文件，远端变更可能延迟到你手动启动客户端后处理。",
    manualUse: "手动打开同步客户端后，文件同步通常会继续。",
    recommendationReason: "持续备份或跨设备同步文件时建议保留；不需要自动同步时可以关闭。"
  },
  {
    category: "updater",
    confidence: "medium",
    recommendation: "optional",
    evidenceLabel: "名称、文件名或参数显示为更新程序",
    patterns: [/update(?:r)?|auto[- ]?update|updateagent|updatecheck|升级|更新/i],
    disabledEffect: "后台自动检查或安装更新可能延后，不会再因该入口随登录运行。",
    manualUse: "多数软件仍可在主程序启动时或设置页面中手动检查更新。",
    recommendationReason: "通常可以关闭，但需要自行留意重要版本和安全更新。"
  },
  {
    category: "launcher",
    confidence: "medium",
    recommendation: "optional",
    evidenceLabel: "名称或可执行文件显示为应用启动器",
    patterns: [/launcher|steam|epic|battle\.net|game\s*client|启动器|游戏平台/i],
    disabledEffect: "该启动器不会在登录后自动出现，相关商店、游戏或应用也不会预先驻留后台。",
    manualUse: "需要时仍可从桌面或开始菜单手动打开启动器和应用。",
    recommendationReason: "不需要开机立即使用时可以关闭。"
  }
];
function sourceEvidence(source) {
  if (source === "registry") return "注册表登录启动入口";
  if (source === "startup-folder") return "启动文件夹入口";
  return "非 Microsoft 计划任务入口";
}
function classifyStartupEffect(entry) {
  const executableName = entry.executablePath ? win32.basename(entry.executablePath) : "";
  const description = [entry.name, entry.publisher ?? "", executableName, entry.command].join("\n");
  const match = EFFECTS.find((template) => template.patterns.some((pattern) => pattern.test(description)));
  if (match) {
    const { patterns: _patterns, evidenceLabel, ...effect } = match;
    return { ...effect, evidence: [evidenceLabel, sourceEvidence(entry.source)] };
  }
  return {
    category: "generic",
    confidence: "low",
    recommendation: "review",
    disabledEffect: "它不会随登录自动运行；净界无法仅凭本机可见信息可靠判断同步、更新或通知等具体影响。",
    manualUse: "手动打开该软件通常仍可使用，但部分后台功能可能需要再次启用启动项。",
    recommendationReason: "请先确认软件身份和用途；影响不明确时不建议批量关闭。",
    evidence: [sourceEvidence(entry.source), "名称与发布者信息不足"]
  };
}

export {
  EFFECTS,
  classifyStartupEffect
};
