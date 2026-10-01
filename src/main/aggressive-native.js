/**
 * aggressive-native.js -- recovered from the packaged main bundle (electron-vite output, out/main/main.js).
 * fs-helper v2 session: protected-root manifest handed to the native side before any delete.
 * Provenance: see docs/SOURCE-RECOVERY.md. Slices are byte-identical to the bundle except for
 * the documented symbol renames (esbuild added $1/$2 suffixes to duplicate names).
 */
import { win32, join, dirname, resolve, isAbsolute, parse, relative, basename } from "node:path";
import { execFile, spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { promisify } from "node:util";
const execFileAsync = promisify(execFile);
function encodeValue(value) {
  return Buffer.from(value, "utf8").toString("base64");
}
function decodeValue(value) {
  return Buffer.from(value, "base64").toString("utf8");
}
class NativeAggressiveDeleteSession {
  child;
  exited;
  requestId = 0;
  pending;
  closed = false;
  exitError;
  stderr = "";
  constructor(helperPath, protectedRoots2) {
    if (protectedRoots2.length > 128) throw new Error("too-many-protected-roots");
    this.child = spawn(helperPath, ["delete-session-v2", ...protectedRoots2.map(encodeValue)], {
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
      shell: false
    });
    const lines = createInterface({ input: this.child.stdout, crlfDelay: Infinity });
    lines.on("line", (line) => this.handleLine(line));
    this.child.stderr.on("data", (chunk) => {
      this.stderr = (this.stderr + String(chunk)).slice(-16 * 1024);
    });
    this.exited = new Promise((resolve2) => {
      this.child.once("error", (error) => {
        this.exitError = error;
        this.rejectPending(error);
      });
      this.child.once("exit", (code, signal) => {
        if (!this.closed || code !== 0) {
          this.exitError = new Error(this.stderr.trim() || `native-aggressive-session-exited:${code ?? signal ?? "unknown"}`);
          this.rejectPending(this.exitError);
        }
        resolve2();
      });
    });
  }
  deleteFile(request) {
    if (this.closed) return Promise.reject(new Error("native-aggressive-session-closed"));
    if (this.exitError) return Promise.reject(this.exitError);
    if (this.pending) return Promise.reject(new Error("native-aggressive-session-busy"));
    if (!/^[a-z0-9-]{1,128}$/.test(request.nativeRuleId)) return Promise.reject(new Error("invalid-native-rule"));
    const id = String(++this.requestId);
    const modifiedMs = Date.parse(request.expectedModifiedAt);
    const line = [
      "v2",
      id,
      request.nativeRuleId,
      encodeValue(request.anchorPath),
      encodeValue(request.ruleRoot),
      encodeValue(request.targetPath),
      String(request.expectedSize),
      String(modifiedMs)
    ].join("	") + "\n";
    return new Promise((resolve2, reject) => {
      const timer = setTimeout(() => {
        this.pending = void 0;
        reject(new Error("native-delete-timeout"));
        this.child.kill();
      }, 3e4);
      this.pending = { id, resolve: resolve2, reject, timer };
      this.child.stdin.write(line, "utf8", (error) => {
        if (error) this.rejectPending(error);
      });
    });
  }
  async close() {
    if (this.closed) return this.exited;
    this.closed = true;
    this.child.stdin.end();
    const forceClose = setTimeout(() => this.child.kill(), 5e3);
    try {
      await this.exited;
    } finally {
      clearTimeout(forceClose);
    }
  }
  handleLine(line) {
    const separator = line.indexOf("	");
    const id = separator >= 0 ? line.slice(0, separator) : "";
    const result = separator >= 0 ? line.slice(separator + 1).trim() : "";
    if (!this.pending || id !== this.pending.id) {
      this.exitError = new Error("native-aggressive-protocol-error");
      this.rejectPending(this.exitError);
      this.child.kill();
      return;
    }
    const pending = this.pending;
    this.pending = void 0;
    clearTimeout(pending.timer);
    if (result === "deleted") pending.resolve();
    else pending.reject(new Error(result || "native-delete-failed"));
  }
  rejectPending(error) {
    if (!this.pending) return;
    const pending = this.pending;
    this.pending = void 0;
    clearTimeout(pending.timer);
    pending.reject(error);
  }
}
class NativeAggressiveOperations {
  constructor(helperPath, invoke) {
    this.helperPath = helperPath;
    this.invoke = invoke ?? (async (args) => {
      try {
        const { stdout } = await execFileAsync(this.helperPath, args, {
          windowsHide: true,
          shell: false,
          timeout: 3e4,
          maxBuffer: 256 * 1024,
          encoding: "utf8"
        });
        return stdout.trim();
      } catch (error) {
        const stdout = typeof error === "object" && error && "stdout" in error ? String(error.stdout).trim() : "";
        throw new Error(stdout || (error instanceof Error ? error.message : "native-aggressive-operation-failed"));
      }
    });
  }
  helperPath;
  invoke;
  async getProtectedRoots() {
    const output = JSON.parse(await this.invoke(["protected-roots"]));
    if (!Array.isArray(output.personalFolders) || !Array.isArray(output.cloudRoots)) throw new Error("invalid-protected-roots");
    const read = (values) => values.map((value) => {
      if (typeof value !== "string") throw new Error("invalid-protected-roots");
      return decodeValue(value);
    });
    return { personalFolders: read(output.personalFolders), cloudRoots: read(output.cloudRoots) };
  }
  async queryRecycleBin() {
    const result = JSON.parse(await this.invoke(["recycle-bin-query"]));
    if (!Number.isSafeInteger(result.itemCount) || Number(result.itemCount) < 0 || !Number.isSafeInteger(result.sizeBytes) || Number(result.sizeBytes) < 0) throw new Error("invalid-recycle-bin-result");
    return { itemCount: Number(result.itemCount), sizeBytes: Number(result.sizeBytes) };
  }
  async emptyRecycleBin() {
    if (await this.invoke(["recycle-bin-empty"]) !== "emptied") throw new Error("recycle-bin-empty-failed");
  }
  async openDeleteSession(protectedRoots2) {
    return new NativeAggressiveDeleteSession(this.helperPath, protectedRoots2);
  }
}

export {
  NativeAggressiveDeleteSession,
  NativeAggressiveOperations
};
