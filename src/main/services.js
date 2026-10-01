/**
 * services.js -- the composition root, extracted from the packaged bootstrap so it can be
 * driven WITHOUT Electron (the Agent API on port 8796 and the test suite both do this).
 *
 * Every controller is the recovered original; nothing here re-implements scan, quarantine,
 * uninstall or startup logic. `dataRoot` / `providerRoot` / `helperPath` are injected so a
 * caller can point writes at a scratch directory instead of the user's real app data.
 */
import { win32, join } from "node:path";
import { createDefaultRules } from "./rules.js";
import { evaluateRestoreTargetPath } from "./path-guard.js";
import { QuarantineService } from "./quarantine.js";
import { CleanerController } from "./cleaner-controller.js";
import { NativeSecureFileOperations } from "./native-delete.js";
import { PowerShellRunner } from "./powershell-runner.js";
import { AggressiveController } from "./aggressive-controller.js";
import { NativeAggressiveOperations } from "./aggressive-native.js";
import { MaintenanceProvider, NativeElevatedMaintenanceRunner } from "./maintenance.js";
import { SoftwareProvider } from "./software-provider.js";
import { WindowsUninstallProcessRunner, PowerShellAppxActionRunner, ExecFileProcessRunner, UninstallExecutor } from "./uninstall-executors.js";
import { NativeElevatedProcessRunner } from "./elevation.js";
import { SoftwareController } from "./software-controller.js";
import { StartupProvider } from "./startup-provider.js";
import { StartupController } from "./startup-controller.js";
import { StartupActions } from "./startup-actions.js";
import { NativeElevatedStartupRunner } from "./elevated-startup-runner.js";
import { PlanController } from "./plan-controller.js";

/**
 * @param {object} options
 * @param {{ userProfile: string, localAppData: string, tempRoot: string, windowsRoot: string }} options.env
 * @param {{ programFiles: string, programFilesX86: string, selfPath: string }} [options.folders]
 * @param {string} options.dataRoot      where ledgers / quarantine / backups are written
 * @param {string} options.providerRoot  folder holding the allowlisted *.ps1 providers
 * @param {string|null} options.helperPath fs-helper executable, or null when unavailable
 */
export function createServices({ env, folders = {}, dataRoot, providerRoot, helperPath }) {
  if (!env || !dataRoot || !providerRoot) throw new Error("services: env, dataRoot and providerRoot are required");
  const fileOperations = new NativeSecureFileOperations(helperPath);
  const powerShell = new PowerShellRunner(providerRoot);
  const rules = createDefaultRules(env);
  const quarantine = new QuarantineService({
    root: join(dataRoot, "quarantine"),
    isRestoreTargetAllowed: (entry) => {
      const rule = rules.find((candidate) => candidate.id === entry.ruleId);
      return rule?.enabled && rule.mode === "quarantine"
        ? evaluateRestoreTargetPath(entry.originalPath, rule, env).then((decision) => decision.allowed).catch(() => false)
        : false;
    }
  });
  const cleanerController = new CleanerController({
    env,
    rules,
    quarantine,
    fileOperations,
    historyPath: join(dataRoot, "history.json")
  });
  const nativeAggressive = helperPath ? new NativeAggressiveOperations(helperPath) : null;
  const aggressiveController = new AggressiveController({
    env,
    native: nativeAggressive,
    maintenance: new MaintenanceProvider(powerShell, helperPath ? new NativeElevatedMaintenanceRunner(helperPath) : unavailableMaintenanceRunner()),
    historyPath: join(dataRoot, "aggressive-history.json"),
    helperAvailable: Boolean(helperPath)
  });
  const softwareController = new SoftwareController({
    provider: new SoftwareProvider(powerShell, {
      windowsRoot: env.windowsRoot,
      programFiles: folders.programFiles ?? "C:\\Program Files",
      programFilesX86: folders.programFilesX86 ?? "C:\\Program Files (x86)",
      selfPath: folders.selfPath ?? process.execPath
    }),
    executor: new UninstallExecutor(
      new WindowsUninstallProcessRunner(
        new ExecFileProcessRunner(),
        helperPath ? new NativeElevatedProcessRunner(helperPath) : unavailableElevationRunner()
      ),
      new PowerShellAppxActionRunner(powerShell)
    ),
    historyPath: join(dataRoot, "software-history.json")
  });
  const startupController = new StartupController({
    provider: new StartupProvider(powerShell, { windowsRoot: env.windowsRoot }),
    actions: new StartupActions({
      runner: powerShell,
      elevatedRunner: new NativeElevatedStartupRunner(helperPath ?? "", providerRoot),
      startupRoots: [
        join(process.env.APPDATA ?? join(env.userProfile, "AppData", "Roaming"), "Microsoft", "Windows", "Start Menu", "Programs", "Startup"),
        join(process.env.ProgramData ?? "C:\\ProgramData", "Microsoft", "Windows", "Start Menu", "Programs", "Startup")
      ],
      backupRoot: join(dataRoot, "startup-backups"),
      regBackupRoot: join(dataRoot, "startup-reg-backups")
    }),
    historyPath: join(dataRoot, "startup-history.json")
  });
  const planController = new PlanController({
    dataRoot,
    cleanerController,
    aggressiveController,
    softwareController,
    startupController,
    nativeAggressive
  });

  return {
    env,
    rules,
    quarantine,
    fileOperations,
    powerShell,
    helperPath,
    cleanerController,
    aggressiveController,
    softwareController,
    startupController,
    planController
  };
}

/** When the native helper is missing, elevated work fails closed with a reason instead of silently skipping UAC. */
function unavailableElevationRunner() {
  return {
    async run() {
      return { exitCode: null, stdout: "", stderr: "", timedOut: false, failureReason: "fs-helper-missing" };
    }
  };
}

function unavailableMaintenanceRunner() {
  return {
    async runActions() {
      return { ok: false, reason: "fs-helper-missing" };
    }
  };
}

/**
 * Derive the environment the path guards need, without Electron.
 * The guards themselves re-check every one of these values before anything is touched
 * (path-guard.js: environmentIsSafe), so an odd LOCALAPPDATA simply makes rules unusable.
 */
export function buildEnvFromProcess(processEnv = process.env) {
  const userProfile = win32.resolve(processEnv.USERPROFILE ?? "");
  const localAppData = win32.resolve(processEnv.LOCALAPPDATA ?? join(userProfile, "AppData", "Local"));
  // tempRoot is derived, never read from %TEMP%: the variable is often the 8.3 short form
  // (C:\Users\ADMINI~1\...) and the path guards compare canonical roots, so a short form here
  // would make every rule refuse with unsafe-rule-root.
  return {
    userProfile,
    localAppData,
    tempRoot: join(localAppData, "Temp"),
    windowsRoot: win32.resolve(processEnv.SystemRoot ?? processEnv.WINDIR ?? "")
  };
}

/** Program Files folders, with an env fallback for when the native helper is unavailable. */
export function buildFoldersFromProcess(processEnv = process.env) {
  return {
    programFiles: win32.resolve(processEnv.ProgramFiles ?? ""),
    programFilesX86: win32.resolve(processEnv["ProgramFiles(x86)"] ?? processEnv["ProgramW6432"] ?? ""),
    selfPath: process.execPath
  };
}
