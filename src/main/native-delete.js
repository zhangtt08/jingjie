/**
 * native-delete.js -- recovered from the packaged main bundle (electron-vite output, out/main/main.js).
 * fs-helper subprocess: anchored, size/mtime-checked single-file delete (batch session).
 * Provenance: see docs/SOURCE-RECOVERY.md. Slices are byte-identical to the bundle except for
 * the documented symbol renames (esbuild added $1/$2 suffixes to duplicate names).
 */
import { win32, join, dirname, resolve, isAbsolute, parse, relative, basename } from "node:path";
import { execFile, spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { promisify } from "node:util";
const execFileAsync$2 = promisify(execFile);
function encodePath(value) {
  return Buffer.from(value, "utf8").toString("base64");
}
class NativeDeleteSession {
  child;
  exited;
  requestId = 0;
  pending;
  closed = false;
  exitError;
  stderr = "";
  constructor(helperPath) {
    this.child = spawn(helperPath, ["delete-session"], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
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
        const unexpected = !this.closed || code !== 0;
        if (unexpected) {
          this.exitError = new Error(this.stderr.trim() || `native-delete-session-exited:${code ?? signal ?? "unknown"}`);
          this.rejectPending(this.exitError);
        }
        resolve2();
      });
    });
  }
  deleteFile(request) {
    if (this.closed) return Promise.reject(new Error("native-delete-session-closed"));
    if (this.exitError) return Promise.reject(this.exitError);
    if (this.pending) return Promise.reject(new Error("native-delete-session-busy"));
    const id = String(++this.requestId);
    const line = [
      "v1",
      id,
      encodePath(request.anchorPath),
      encodePath(request.ruleRoot),
      encodePath(request.targetPath),
      String(request.expectedSize),
      String(Date.parse(request.expectedModifiedAt))
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
      this.exitError = new Error("native-delete-protocol-error");
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
class NativeSecureFileOperations {
  constructor(helperPath) {
    this.helperPath = helperPath;
  }
  helperPath;
  async getSystemFolders() {
    const { stdout } = await execFileAsync$2(this.helperPath, ["system-folders"], {
      windowsHide: true,
      timeout: 1e4,
      maxBuffer: 16 * 1024,
      encoding: "utf8"
    });
    const encoded = JSON.parse(stdout.trim());
    const decode2 = (name) => {
      const value = encoded[name];
      if (!value) throw new Error("invalid-system-folders");
      return Buffer.from(value, "base64").toString("utf8");
    };
    return { windowsRoot: decode2("windowsRoot"), programFiles: decode2("programFiles"), programFilesX86: decode2("programFilesX86") };
  }
  async deleteFile(request) {
    try {
      const { stdout } = await execFileAsync$2(this.helperPath, [
        "delete",
        encodePath(request.anchorPath),
        encodePath(request.ruleRoot),
        encodePath(request.targetPath),
        String(request.expectedSize),
        String(Date.parse(request.expectedModifiedAt))
      ], {
        windowsHide: true,
        timeout: 3e4,
        maxBuffer: 16 * 1024
      });
      if (stdout.trim() !== "deleted") throw new Error(stdout.trim() || "native-delete-failed");
    } catch (error) {
      const stdout = typeof error === "object" && error && "stdout" in error ? String(error.stdout).trim() : "";
      throw new Error(stdout || (error instanceof Error ? error.message : "native-delete-failed"));
    }
  }
  async openSession() {
    return new NativeDeleteSession(this.helperPath);
  }
}

export {
  NativeDeleteSession,
  NativeSecureFileOperations
};
