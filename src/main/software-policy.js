/**
 * software-policy.js -- recovered from the packaged main bundle (electron-vite output, out/main/main.js).
 * uninstall risk classification: what may never be removed by this app.
 * Provenance: see docs/SOURCE-RECOVERY.md. Slices are byte-identical to the bundle except for
 * the documented symbol renames (esbuild added $1/$2 suffixes to duplicate names).
 */
import { win32, join, dirname, resolve, isAbsolute, parse, relative, basename } from "node:path";
const OFFICIAL_ONLY_PATTERNS = [
  /\b(driver|firmware|chipset|display adapter|graphics)\b/i,
  /\b(antivirus|anti-virus|endpoint|security|defender|firewall)\b/i,
  /\b(vpn|virtual (?:network|adapter)|tap[- ]windows|wireguard)\b/i,
  /\b(input method|\bime\b|输入法)\b/i
];
const IMMUTABLE_PATTERNS = [
  /(?:\bupdate for (?:microsoft )?windows\b|\bkb\d{6,8}\b)/i,
  /\bvisual c\+\+.*redistributable\b/i,
  /\bwindows (?:desktop )?runtime\b/i
];
function canonicalPath(value) {
  return win32.resolve(value).replace(/[\\/]+$/, "").toLocaleLowerCase("en-US");
}
function isAtOrBelowPath(candidate, root) {
  return candidate === root || candidate.startsWith(`${root}\\`);
}
function combinedText(item) {
  return `${item.name}
${item.publisher ?? ""}`;
}
function classifySoftware(item, environment) {
  const reasons = [];
  const hasOfficialUninstaller = item.uninstallKind !== "none";
  const description = combinedText(item);
  if (item.systemComponent) reasons.push("system-component");
  if (IMMUTABLE_PATTERNS.some((pattern) => pattern.test(description))) reasons.push("shared-system-component");
  if (item.source === "appx" && /^CN=Microsoft (?:Corporation|Windows)\b/i.test(item.publisher ?? "")) {
    reasons.push("microsoft-system-package");
  }
  const officialOnly = OFFICIAL_ONLY_PATTERNS.some((pattern) => pattern.test(description));
  if (officialOnly) reasons.push("protected-software-category");
  const installLocation = item.installLocation ? canonicalPath(item.installLocation) : void 0;
  if (installLocation) {
    const windowsRoot = canonicalPath(environment.windowsRoot);
    const programFiles = canonicalPath(environment.programFiles);
    const programFilesX86 = canonicalPath(environment.programFilesX86);
    const selfDirectory = canonicalPath(win32.dirname(environment.selfPath));
    if (isAtOrBelowPath(installLocation, windowsRoot)) reasons.push("windows-path");
    if (installLocation === programFiles || installLocation === programFilesX86) reasons.push("broad-install-root");
    if (isAtOrBelowPath(installLocation, selfDirectory)) reasons.push("self-protection");
  }
  const immutable = reasons.some((reason) => [
    "system-component",
    "shared-system-component",
    "windows-path",
    "broad-install-root",
    "self-protection",
    "microsoft-system-package"
  ].includes(reason));
  if (immutable || officialOnly) {
    return {
      risk: "protected",
      standardUninstallAllowed: hasOfficialUninstaller && !immutable,
      forceRemovalAllowed: false,
      reasons
    };
  }
  if (item.source === "appx") {
    return {
      risk: "ordinary",
      standardUninstallAllowed: hasOfficialUninstaller,
      forceRemovalAllowed: false,
      reasons: []
    };
  }
  const attributionEvidence = [item.publisher, item.registryKey ?? item.packageFullName, item.installLocation].filter((value) => typeof value === "string" && value.trim().length > 0).length;
  if (attributionEvidence < 3) {
    return {
      risk: "caution",
      standardUninstallAllowed: hasOfficialUninstaller,
      forceRemovalAllowed: false,
      reasons: ["insufficient-attribution"]
    };
  }
  return {
    risk: "ordinary",
    standardUninstallAllowed: hasOfficialUninstaller,
    forceRemovalAllowed: hasOfficialUninstaller,
    reasons: []
  };
}
function applySoftwarePolicy(item, environment) {
  const decision = classifySoftware(item, environment);
  return {
    ...item,
    risk: decision.risk,
    protectedReasons: decision.reasons,
    standardUninstallAllowed: decision.standardUninstallAllowed,
    forceRemovalAllowed: decision.forceRemovalAllowed
  };
}

export {
  classifySoftware,
  applySoftwarePolicy,
  OFFICIAL_ONLY_PATTERNS,
  IMMUTABLE_PATTERNS
};
