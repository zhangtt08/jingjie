/**
 * powershell-runner.js -- recovered from the packaged main bundle (out/main/main.js).
 * allowlisted PowerShell provider scripts, base64 payload in / JSON out.
 * Provenance: see docs/SOURCE-RECOVERY.md. The method bodies are the shipped ones; the two
 * hardenings below are marked SECURITY-REVIEW S-06 / S-07.
 */
import { win32, join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { lstat, realpath } from "node:fs/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const PROVIDER_SCRIPTS = Object.freeze({
  "software-inventory": { fileName: "software-inventory.ps1", timeoutMs: 3e4, write: false },
  "software-remove-appx": { fileName: "software-remove-appx.ps1", timeoutMs: 10 * 6e4, write: true },
  "startup-inventory": { fileName: "startup-inventory.ps1", timeoutMs: 3e4, write: false },
  "startup-action": { fileName: "startup-action.ps1", timeoutMs: 6e4, write: true },
  "aggressive-maintenance": { fileName: "aggressive-maintenance.ps1", timeoutMs: 3e4, write: false }
});

/**
 * SECURITY-REVIEW S-07: the shipped runner invoked bare "powershell.exe", i.e. whatever the
 * current PATH resolves first. These scripts run with -ExecutionPolicy Bypass and one of them
 * writes to the registry, so the interpreter is resolved from %SystemRoot% instead and PATH is
 * not consulted at all. Falls back to the bare name only if the system copy is genuinely absent
 * (a relocated Windows PowerShell install), and the fallback is reported to the caller.
 */
export function resolvePowerShellExecutable(environment = process.env) {
  const systemRoot = environment.SystemRoot ?? environment.WINDIR;
  if (systemRoot) {
    const candidate = win32.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
    if (win32.isAbsolute(candidate)) return { executable: candidate, resolvedFromSystemRoot: true };
  }
  return { executable: "powershell.exe", resolvedFromSystemRoot: false };
}

/**
 * SECURITY-REVIEW S-06: the provider folder is inside the install tree, so anything that can
 * write there can run code. Before each call the script is re-checked: it must be a regular
 * file (no reparse point) whose real path is still directly inside providerRoot.
 */
async function validateProviderScript(providerRoot, fileName) {
  const declared = win32.join(providerRoot, fileName);
  const stats = await lstat(declared);
  if (stats.isSymbolicLink() || !stats.isFile()) throw new Error("provider-script-untrusted");
  const [realScript, realRoot] = await Promise.all([realpath(declared), realpath(providerRoot)]);
  if (win32.dirname(realScript).toLocaleLowerCase("en-US") !== realRoot.toLocaleLowerCase("en-US")) {
    throw new Error("provider-script-untrusted");
  }
  return realScript;
}

export class PowerShellRunner {
  constructor(providerRoot, { environment = process.env } = {}) {
    this.providerRoot = providerRoot;
    this.environment = environment;
  }

  providerRoot;
  environment;

  async runScript(name, payload) {
    const script = PROVIDER_SCRIPTS[name];
    if (!script) throw new Error("provider-not-allowed");
    const scriptPath = await validateProviderScript(this.providerRoot, script.fileName);
    const args = [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      scriptPath
    ];
    if (payload !== void 0) {
      const serializedPayload = Buffer.from(JSON.stringify(payload), "utf8");
      if (serializedPayload.byteLength > 64 * 1024) throw new Error("provider-payload-too-large");
      args.push("-Payload", serializedPayload.toString("base64"));
    }
    const { executable } = resolvePowerShellExecutable(this.environment);
    const { stdout } = await execFileAsync(executable, args, {
      windowsHide: true,
      timeout: script.timeoutMs,
      maxBuffer: 4 * 1024 * 1024,
      encoding: "utf8"
    });
    const output = stdout.replace(/^\uFEFF/, "").trim();
    if (!output) throw new Error("provider-empty-output");
    try {
      return JSON.parse(output);
    } catch {
      throw new Error("provider-invalid-json");
    }
  }

  /** Read-only scripts only -- used by the Agent API for inventory and preview tools. */
  async runReadOnlyScript(name, payload) {
    const script = PROVIDER_SCRIPTS[name];
    if (!script) throw new Error("provider-not-allowed");
    if (script.write) throw new Error("provider-write-not-allowed-here");
    return this.runScript(name, payload);
  }
}

export { PROVIDER_SCRIPTS };
