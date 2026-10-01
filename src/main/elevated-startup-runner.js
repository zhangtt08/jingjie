/**
 * elevated-startup-runner.js -- recovered from the packaged main bundle (electron-vite output, out/main/main.js).
 * elevated startup-action runner through fs-helper.
 * Provenance: see docs/SOURCE-RECOVERY.md. Slices are byte-identical to the bundle except for
 * the documented symbol renames (esbuild added $1/$2 suffixes to duplicate names).
 */
import { win32, join, dirname, resolve, isAbsolute, parse, relative, basename } from "node:path";
import { execFile, spawn } from "node:child_process";
function encodeValue(value) {
  return Buffer.from(value, "utf8").toString("base64");
}
class NativeElevatedStartupRunner {
  constructor(helperPath, providerRoot) {
    this.helperPath = helperPath;
    this.providerRoot = providerRoot;
  }
  helperPath;
  providerRoot;
  runScript(name, payload) {
    if (name !== "startup-action") return Promise.resolve({ ok: false, reason: "provider-not-allowed" });
    const serialized = JSON.stringify(payload);
    if (Buffer.byteLength(serialized, "utf8") > 64 * 1024) {
      return Promise.resolve({ ok: false, reason: "provider-payload-too-large" });
    }
    return new Promise((resolve2) => {
      execFile(this.helperPath, [
        "run-startup-provider-elevated",
        encodeValue(join(this.providerRoot, "startup-action.ps1")),
        "60000",
        encodeValue(serialized)
      ], {
        windowsHide: true,
        shell: false,
        timeout: 7e4,
        maxBuffer: 16 * 1024,
        encoding: "utf8"
      }, (error, stdout) => {
        const output = stdout.trim();
        const completed = /^completed:(-?\d+)$/.exec(output);
        if (completed?.[1] === "0") return resolve2({ ok: true });
        if (output === "uac-cancelled") return resolve2({ ok: false, reason: "uac-cancelled" });
        if (output === "timeout" || error?.killed) return resolve2({ ok: false, reason: "timeout" });
        resolve2({ ok: false, reason: completed ? `exit-code-${completed[1]}` : output || "elevation-helper-failed" });
      });
    });
  }
}

export {
  NativeElevatedStartupRunner
};
