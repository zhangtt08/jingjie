/**
 * startup-policy.js -- recovered from the packaged main bundle (electron-vite output, out/main/main.js).
 * which startup entries must never be touched.
 * Provenance: see docs/SOURCE-RECOVERY.md. Slices are byte-identical to the bundle except for
 * the documented symbol renames (esbuild added $1/$2 suffixes to duplicate names).
 */
import { win32, join, dirname, resolve, isAbsolute, parse, relative, basename } from "node:path";
const PROTECTED_PATTERNS = [
  /\b(?:anti-?virus|endpoint|security|firewall|defender|huorong|hipstray|sysdiag)\b|火绒/i,
  /\b(?:vpn|virtual (?:network|adapter)|wireguard|tap[- ]windows)\b/i,
  /\b(?:input method|\bime\b|输入法)\b/i,
  /\b(?:driver|firmware|chipset|graphics)\b/i
];
function canonicalPath(value) {
  return win32.resolve(value).replace(/[\\/]+$/, "").toLocaleLowerCase("en-US");
}
function isAtOrBelowPath(candidate, root) {
  return candidate === root || candidate.startsWith(`${root}\\`);
}
function classifyStartupEntry(entry, environment) {
  const reasons = [];
  if (entry.source === "scheduled-task" && /^\\microsoft\\/i.test(entry.taskPath ?? "")) {
    reasons.push("microsoft-task");
  }
  if (entry.executablePath && isAtOrBelowPath(canonicalPath(entry.executablePath), canonicalPath(environment.windowsRoot))) {
    reasons.push("windows-executable");
  }
  const description = `${entry.name}
${entry.publisher ?? ""}
${entry.command}`;
  if (PROTECTED_PATTERNS.some((pattern) => pattern.test(description))) {
    reasons.push("protected-software-category");
  }
  if (/\bMicrosoft (?:Corporation|Windows)\b/i.test(entry.publisher ?? "")) {
    reasons.push("microsoft-publisher");
  }
  return reasons.length > 0 ? { protected: true, canDisable: false, reasons: [...new Set(reasons)] } : { protected: false, canDisable: true, reasons: [] };
}
function applyStartupPolicy(entry, environment) {
  const decision = classifyStartupEntry(entry, environment);
  return {
    ...entry,
    protected: decision.protected,
    protectedReasons: decision.reasons,
    canDisable: decision.canDisable
  };
}

export {
  classifyStartupEntry,
  applyStartupPolicy,
  PROTECTED_PATTERNS
};
