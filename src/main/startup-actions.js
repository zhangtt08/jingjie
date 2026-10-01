/**
 * startup-actions.js -- recovered from the packaged main bundle (electron-vite output, out/main/main.js).
 * reversible disable/restore: .reg backup + value re-check + file rename into backup root.
 * Provenance: see docs/SOURCE-RECOVERY.md. Slices are byte-identical to the bundle except for
 * the documented symbol renames (esbuild added $1/$2 suffixes to duplicate names).
 */
import { win32, join, dirname, resolve, isAbsolute, parse, relative, basename } from "node:path";
import { createReadStream, constants, realpathSync } from "node:fs";
import { lstat, realpath, readFile, mkdir, open, rm, rename, rmdir, unlink, copyFile, chmod, utimes, opendir, access, readdir, stat } from "node:fs/promises";
function canonicalPath(value) {
  return resolve(value).replace(/[\\/]+$/, "").toLocaleLowerCase("en-US");
}
function validBackupId(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
/** " and \ are the two characters that would break out of a .reg value name. */
function escapeRegValueName(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
class StartupActions {
  constructor(options) {
    this.options = options;
    this.startupRoots = new Set(options.startupRoots.map(canonicalPath));
    this.backupRoot = resolve(options.backupRoot);
    this.regBackupRoot = resolve(options.regBackupRoot ?? join(this.backupRoot, "..", "startup-reg-backups"));
    this.now = options.now ?? (() => /* @__PURE__ */ new Date());
  }
  options;
  startupRoots;
  backupRoot;
  regBackupRoot;
  now;
  async runProvider(payload, elevated = false) {
    const runner = elevated ? this.options.elevatedRunner : this.options.runner;
    if (!runner) throw new Error("startup-elevation-runner-missing");
    const result = await runner.runScript("startup-action", payload);
    if (!result?.ok) throw new Error(result?.reason ?? "startup-action-failed");
  }
  assertEntryCanChange(entry) {
    if (entry.protected || !entry.canDisable) throw new Error("startup-entry-protected");
  }
  async disableFile(entry, backupId) {
    if (!entry.filePath || entry.fileSize === null || !entry.fileModifiedAt) throw new Error("invalid-startup-file");
    const sourcePath = resolve(entry.filePath);
    const sourceParent = canonicalPath(dirname(sourcePath));
    if (!this.startupRoots.has(sourceParent)) throw new Error("outside-startup-root");
    const physicalParent = canonicalPath(await realpath(dirname(sourcePath)));
    const configuredPhysicalRoots = await Promise.all([...this.startupRoots].map((root) => realpath(root).then(canonicalPath)));
    if (!configuredPhysicalRoots.includes(physicalParent)) throw new Error("outside-startup-root");
    const current = await lstat(sourcePath);
    if (!current.isFile() || current.isSymbolicLink()) throw new Error("unsafe-startup-file");
    if (current.size !== entry.fileSize || Math.abs(current.mtimeMs - Date.parse(entry.fileModifiedAt)) > 2) {
      throw new Error("changed-since-inventory");
    }
    const backupPath = join(this.backupRoot, backupId, basename(sourcePath));
    await mkdir(dirname(backupPath), { recursive: true });
    try {
      await access(backupPath, constants.F_OK);
      throw new Error("backup-conflict");
    } catch (error) {
      if (!(typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT")) throw error;
    }
    await rename(sourcePath, backupPath);
    return backupPath;
  }
  async disable(entry, backupId) {
    this.assertEntryCanChange(entry);
    if (!validBackupId(backupId)) throw new Error("invalid-backup-id");
    let backupPath;
    if (entry.source === "registry") {
      if (!entry.registryHive || !entry.registryView || !entry.registryKey || !entry.registryValueName || !entry.registryValueKind) {
        throw new Error("invalid-registry-startup");
      }
      // SECURITY-REVIEW S-05: the shipped code deleted the Run/RunOnce value and kept its only
      // copy in startup-history.json. If that ledger was lost or truncated the entry was gone.
      // A Windows-native .reg file is now written first; the delete is refused if it is not.
      const regBackupPath = await this.writeRegistryBackup(entry, backupId);
      try {
        await this.runProvider({
          operation: "disable-registry",
          hive: entry.registryHive,
          view: entry.registryView,
          key: entry.registryKey,
          valueName: entry.registryValueName,
          expectedValue: entry.command,
          valueKind: entry.registryValueKind
        }, entry.registryHive === "HKLM");
      } catch (error) {
        await unlink(regBackupPath).catch(() => void 0);
        throw error;
      }
      return {
        id: backupId,
        source: entry.source,
        status: "disabled",
        original: structuredClone(entry),
        backupPath: void 0,
        regBackupPath,
        disabledAt: this.now().toISOString()
      };
    } else if (entry.source === "scheduled-task") {
      if (!entry.taskPath || entry.taskEnabled !== true || /^\\microsoft\\/i.test(entry.taskPath)) throw new Error("invalid-scheduled-task");
      await this.runProvider({ operation: "disable-task", taskPath: entry.taskPath, expectedEnabled: true }, true);
    } else {
      backupPath = await this.disableFile(entry, backupId);
    }
    return {
      id: backupId,
      source: entry.source,
      status: "disabled",
      original: structuredClone(entry),
      backupPath,
      disabledAt: this.now().toISOString()
    };
  }
  /**
   * Writes `HKxx\<key>\<valueName>` back out as a double-clickable .reg file (UTF-16LE + BOM,
   * the encoding regedit expects) before anything is deleted. Only String and ExpandString can
   * reach here, which is exactly what startup-inventory.ps1 reports.
   */
  async writeRegistryBackup(entry, backupId) {
    const root = this.regBackupRoot;
    await mkdir(root, { recursive: true });
    const hivePrefix = entry.registryHive === "HKLM" ? "HKEY_LOCAL_MACHINE" : "HKEY_CURRENT_USER";
    const viewSuffix = entry.registryHive === "HKLM" && entry.registryView === "32" ? "\\Wow6432Node" : "";
    const keyPath = `${hivePrefix}\\${entry.registryKey.replace(/^\\+/, "")}${viewSuffix}`;
    const value = entry.command;
    let line;
    if (entry.registryValueKind === "ExpandString") {
      const bytes = Buffer.from(`${value}\0`, "utf16le");
      const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join(",");
      line = `"${escapeRegValueName(entry.registryValueName)}"=hex(2):${hex},`;
    } else {
      line = `"${escapeRegValueName(entry.registryValueName)}"="${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/[\r\n]/g, " ")}"`;
    }
    const text = ["Windows Registry Editor Version 5.00", "", `[${keyPath}]`, line, ""].join("\r\n");
    const payload = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, "utf16le")]);
    const target = join(root, `${backupId}.reg`);
    const handle = await open(target, "wx");
    try {
      await handle.writeFile(payload);
      await handle.sync();
    } finally {
      await handle.close();
    }
    return target;
  }
  async restoreFile(record) {
    const originalPath = record.original.filePath;
    const backupPath = record.backupPath;
    if (!originalPath || !backupPath) throw new Error("invalid-startup-backup");
    if (!canonicalPath(backupPath).startsWith(`${canonicalPath(this.backupRoot)}\\`)) throw new Error("invalid-startup-backup");
    if (!this.startupRoots.has(canonicalPath(dirname(originalPath)))) throw new Error("outside-startup-root");
    try {
      await access(originalPath, constants.F_OK);
      throw new Error("restore-conflict");
    } catch (error) {
      if (!(typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT")) throw error;
    }
    const backup = await lstat(backupPath);
    if (!backup.isFile() || backup.isSymbolicLink()) throw new Error("invalid-startup-backup");
    await rename(backupPath, originalPath);
  }
  async restore(record) {
    if (record.status !== "disabled") throw new Error("startup-record-not-disabled");
    const entry = record.original;
    if (entry.source === "registry") {
      await this.runProvider({
        operation: "restore-registry",
        hive: entry.registryHive,
        view: entry.registryView,
        key: entry.registryKey,
        valueName: entry.registryValueName,
        value: entry.command,
        valueKind: entry.registryValueKind
      }, entry.registryHive === "HKLM");
    } else if (entry.source === "scheduled-task") {
      await this.runProvider({ operation: "restore-task", taskPath: entry.taskPath, expectedCurrentEnabled: false }, true);
    } else {
      await this.restoreFile(record);
    }
    return { ...record, status: "restored", restoredAt: this.now().toISOString() };
  }
}

export {
  StartupActions,
  validBackupId
};
