/**
 * elevation.js -- recovered from the packaged main bundle (electron-vite output, out/main/main.js).
 * elevated process runner (fs-helper UAC bridge).
 * Provenance: see docs/SOURCE-RECOVERY.md. Slices are byte-identical to the bundle except for
 * the documented symbol renames (esbuild added $1/$2 suffixes to duplicate names).
 */
import { execFile, spawn } from "node:child_process";
const invokeElevatedHelper = (helperPath, args, timeoutMs) => new Promise((resolve2) => {
  execFile(helperPath, args, {
    windowsHide: true,
    shell: false,
    timeout: timeoutMs + 1e4,
    maxBuffer: 16 * 1024,
    encoding: "utf8"
  }, (error, stdout, stderr) => {
    resolve2({
      exitCode: error && typeof error.code === "number" ? error.code : error ? null : 0,
      stdout,
      stderr,
      timedOut: Boolean(error?.killed),
      failureReason: error && !error.killed ? "elevation-helper-failed" : void 0
    });
  });
});
function encodeHelperValue(value) {
  return Buffer.from(value, "utf8").toString("base64");
}
class NativeElevatedProcessRunner {
  constructor(helperPath, invoke = invokeElevatedHelper) {
    this.helperPath = helperPath;
    this.invoke = invoke;
  }
  helperPath;
  invoke;
  async run(executable, args, options) {
    const helperResult = await this.invoke(this.helperPath, [
      "run-elevated",
      encodeHelperValue(executable),
      String(options.timeoutMs),
      ...args.map(encodeHelperValue)
    ], options.timeoutMs);
    const output = helperResult.stdout.trim();
    const completed = /^completed:(-?\d+)$/.exec(output);
    if (completed) {
      return { exitCode: Number(completed[1]), stdout: "", stderr: "", timedOut: false };
    }
    if (output === "timeout" || helperResult.timedOut) {
      return { exitCode: null, stdout: "", stderr: "", timedOut: true };
    }
    return {
      exitCode: null,
      stdout: "",
      stderr: helperResult.stderr,
      timedOut: false,
      failureReason: output === "uac-cancelled" ? "uac-cancelled" : (helperResult.failureReason ?? output) || "elevation-helper-failed"
    };
  }
}

export {
  NativeElevatedProcessRunner,
  invokeElevatedHelper
};
