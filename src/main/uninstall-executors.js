/**
 * uninstall-executors.js -- recovered from the packaged main bundle (electron-vite output, out/main/main.js).
 * direct/elevated process runners, appx runner, exit-code normalisation.
 * Provenance: see docs/SOURCE-RECOVERY.md. Slices are byte-identical to the bundle except for
 * the documented symbol renames (esbuild added $1/$2 suffixes to duplicate names).
 */
import { execFile, spawn } from "node:child_process";
class WindowsUninstallProcessRunner {
  constructor(directRunner, elevatedRunner) {
    this.directRunner = directRunner;
    this.elevatedRunner = elevatedRunner;
  }
  directRunner;
  elevatedRunner;
  run(executable, args, options) {
    return options.requiresElevation ? this.elevatedRunner.run(executable, args, options) : this.directRunner.run(executable, args, options);
  }
}
class PowerShellAppxActionRunner {
  constructor(runner) {
    this.runner = runner;
  }
  runner;
  removePackage(action) {
    return this.runner.runScript("software-remove-appx", {
      packageFullName: action.packageFullName
    });
  }
}
class ExecFileProcessRunner {
  run(executable, args, options) {
    return new Promise((resolve2) => {
      execFile(executable, args, {
        windowsHide: true,
        shell: false,
        timeout: options.timeoutMs,
        maxBuffer: 1024 * 1024,
        encoding: "utf8"
      }, (error, stdout, stderr) => {
        const exitCode = error && typeof error.code === "number" ? error.code : error ? null : 0;
        resolve2({
          exitCode,
          stdout,
          stderr,
          timedOut: Boolean(error?.killed),
          failureReason: error && exitCode === null && !error.killed ? "process-launch-failed" : void 0
        });
      });
    });
  }
}
function normalizeResult(result, successExitCodes) {
  if (result.timedOut) return { status: "failed", reason: "timeout" };
  if (result.exitCode === null) return { status: "failed", reason: result.failureReason ?? "process-failed" };
  if (result.exitCode === 1641 || result.exitCode === 3010) {
    return successExitCodes.includes(result.exitCode) ? { status: "reboot-required", exitCode: result.exitCode } : { status: "failed", reason: `exit-code-${result.exitCode}`, exitCode: result.exitCode };
  }
  return successExitCodes.includes(result.exitCode) ? { status: "succeeded", exitCode: result.exitCode } : { status: "failed", reason: `exit-code-${result.exitCode}`, exitCode: result.exitCode };
}
class UninstallExecutor {
  constructor(processRunner, appxRunner) {
    this.processRunner = processRunner;
    this.appxRunner = appxRunner;
  }
  processRunner;
  appxRunner;
  async execute(action) {
    const result = action.kind === "process" ? await this.processRunner.run(action.executable, action.args, {
      timeoutMs: action.timeoutMs,
      requiresElevation: action.requiresElevation
    }) : await this.appxRunner.removePackage(action);
    return normalizeResult(result, action.successExitCodes);
  }
}

export {
  WindowsUninstallProcessRunner,
  PowerShellAppxActionRunner,
  ExecFileProcessRunner,
  normalizeResult,
  UninstallExecutor
};
