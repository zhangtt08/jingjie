/**
 * uninstall-plan.js -- recovered from the packaged main bundle (electron-vite output, out/main/main.js).
 * command line planning: no shell, blocked interpreter hosts, msi/appx/exe kinds.
 * Provenance: see docs/SOURCE-RECOVERY.md. Slices are byte-identical to the bundle except for
 * the documented symbol renames (esbuild added $1/$2 suffixes to duplicate names).
 */
import { win32, join, dirname, resolve, isAbsolute, parse, relative, basename } from "node:path";
const UNINSTALL_TIMEOUT_MS = 10 * 6e4;
const MSI_SUCCESS_EXIT_CODES = [0, 1605, 1614, 1641, 3010];
const BLOCKED_EXECUTABLES = /* @__PURE__ */ new Set([
  "cmd.exe",
  "cscript.exe",
  "mshta.exe",
  "powershell.exe",
  "pwsh.exe",
  "regsvr32.exe",
  "rundll32.exe",
  "wscript.exe"
]);
function environmentValue(environment, name) {
  const key = Object.keys(environment).find((candidate) => candidate.toLocaleLowerCase("en-US") === name.toLocaleLowerCase("en-US"));
  return key ? environment[key] : void 0;
}
function expandEnvironment(command, environment) {
  let valid = true;
  const expanded = command.replace(/%([^%]+)%/g, (_match, name) => {
    const value = environmentValue(environment, name);
    if (value === void 0 || value.includes("\0")) {
      valid = false;
      return "";
    }
    return value;
  });
  return valid ? expanded : null;
}
function tokenizeWindowsCommandLine(command) {
  const tokens = [];
  let index = 0;
  while (index < command.length) {
    while (index < command.length && /\s/.test(command[index])) index += 1;
    if (index >= command.length) break;
    let token = "";
    let inQuotes = false;
    while (index < command.length) {
      let slashCount = 0;
      while (command[index] === "\\") {
        slashCount += 1;
        index += 1;
      }
      if (command[index] === '"') {
        token += "\\".repeat(Math.floor(slashCount / 2));
        if (slashCount % 2 === 1) {
          token += '"';
        } else {
          inQuotes = !inQuotes;
        }
        index += 1;
        continue;
      }
      token += "\\".repeat(slashCount);
      if (index >= command.length || !inQuotes && /\s/.test(command[index])) break;
      token += command[index];
      index += 1;
    }
    if (inQuotes) return null;
    tokens.push(token);
  }
  return tokens.length > 0 ? tokens : null;
}
function planRegisteredExecutable(item, environment) {
  const registeredCommand = item.quietUninstallString ?? item.uninstallString;
  if (!registeredCommand) return { kind: "skip", reason: "missing-uninstall-command" };
  if (/[|<>&\r\n]/.test(registeredCommand)) return { kind: "skip", reason: "unsafe-uninstall-command" };
  const expanded = expandEnvironment(registeredCommand, environment);
  if (!expanded) return { kind: "skip", reason: "unknown-environment-variable" };
  const tokens = tokenizeWindowsCommandLine(expanded);
  if (!tokens) return { kind: "skip", reason: "invalid-uninstall-command" };
  const [executable, ...args] = tokens;
  if (!win32.isAbsolute(executable) || win32.extname(executable).toLocaleLowerCase("en-US") !== ".exe") {
    return { kind: "skip", reason: "invalid-uninstall-executable" };
  }
  if (BLOCKED_EXECUTABLES.has(win32.basename(executable).toLocaleLowerCase("en-US"))) {
    return { kind: "skip", reason: "blocked-uninstall-host" };
  }
  return {
    kind: "process",
    executable: win32.normalize(executable),
    args,
    requiresElevation: item.scope === "machine",
    timeoutMs: UNINSTALL_TIMEOUT_MS,
    successExitCodes: [0, 1605, 1614, 1641, 3010]
  };
}
function createUninstallAction(item, environment = process.env) {
  if (!item.standardUninstallAllowed) return { kind: "skip", reason: "standard-uninstall-not-allowed" };
  if (item.uninstallKind === "msi") {
    const productCode = item.productCode?.trim();
    if (!productCode || !/^\{[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\}$/i.test(productCode)) {
      return { kind: "skip", reason: "invalid-msi-product-code" };
    }
    return {
      kind: "process",
      executable: "msiexec.exe",
      args: ["/x", productCode, "/qn", "/norestart"],
      requiresElevation: item.scope === "machine",
      timeoutMs: UNINSTALL_TIMEOUT_MS,
      successExitCodes: [...MSI_SUCCESS_EXIT_CODES]
    };
  }
  if (item.uninstallKind === "appx") {
    const packageFullName = item.packageFullName?.trim();
    if (!packageFullName || !/^[a-z0-9._-]+$/i.test(packageFullName)) {
      return { kind: "skip", reason: "invalid-appx-package" };
    }
    return {
      kind: "appx",
      packageFullName,
      requiresElevation: false,
      timeoutMs: UNINSTALL_TIMEOUT_MS,
      successExitCodes: [0]
    };
  }
  if (item.uninstallKind !== "exe") return { kind: "skip", reason: "missing-uninstall-command" };
  return planRegisteredExecutable(item, environment);
}

export {
  createUninstallAction,
  tokenizeWindowsCommandLine,
  planRegisteredExecutable,
  BLOCKED_EXECUTABLES,
  UNINSTALL_TIMEOUT_MS
};
