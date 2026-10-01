/**
 * quarantine.js -- recovered from the packaged main bundle (electron-vite output, out/main/main.js).
 * 7-day recoverable quarantine (hash-checked move/restore, expired purge).
 * Provenance: see docs/SOURCE-RECOVERY.md. Slices are byte-identical to the bundle except for
 * the documented symbol renames (esbuild added $1/$2 suffixes to duplicate names).
 */
import { win32, join, dirname, resolve, isAbsolute, parse, relative, basename } from "node:path";
import { createReadStream, constants, realpathSync } from "node:fs";
import { lstat, realpath, readFile, mkdir, open, rm, rename, rmdir, unlink, copyFile, chmod, utimes, opendir, access, readdir, stat } from "node:fs/promises";
import { randomUUID, createHash } from "node:crypto";
import { AtomicJsonStore, SerialExecutor, hasCode } from "./storage.js";
async function hashFile(filePath) {
  const hash2 = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash2.update(chunk);
  return hash2.digest("hex");
}
async function moveFile(source, target) {
  await mkdir(dirname(target), { recursive: true });
  try {
    await rename(source, target);
  } catch (error) {
    if (hasCode(error, "EXDEV")) {
      await copyFile(source, target, constants.COPYFILE_EXCL);
      try {
        await unlink(source);
      } catch (unlinkError) {
        await rm(target, { force: true });
        throw unlinkError;
      }
      return;
    }
    throw error;
  }
}
async function restoreFileExclusive(source, target, entry) {
  await mkdir(dirname(target), { recursive: true });
  let created = false;
  try {
    await copyFile(source, target, constants.COPYFILE_EXCL);
    created = true;
    if (await hashFile(target) !== entry.sha256) throw new Error("integrity-check-failed");
    await chmod(target, entry.fileMode);
    await utimes(target, new Date(entry.accessedAt), new Date(entry.modifiedAt));
    await unlink(source);
  } catch (error) {
    if (created) await rm(target, { force: true });
    throw error;
  }
}
class QuarantineService {
  constructor(options) {
    this.options = options;
    const normalizedRoot = resolve(options.root);
    if (!isAbsolute(normalizedRoot) || normalizedRoot === parse(normalizedRoot).root) {
      throw new Error("unsafe-quarantine-root");
    }
    this.rootPath = normalizedRoot;
    this.store = new AtomicJsonStore(join(normalizedRoot, "index.json"), []);
    this.now = options.now ?? (() => /* @__PURE__ */ new Date());
  }
  options;
  store;
  now;
  serial = new SerialExecutor();
  rootPath;
  objectPath(id) {
    return join(this.rootPath, "objects", id);
  }
  storedPath(id) {
    return join(this.objectPath(id), "payload");
  }
  async safeObjectDirectory(id, create) {
    const objectsRoot = join(this.rootPath, "objects");
    await mkdir(objectsRoot, { recursive: true });
    const [rootStats, objectsStats] = await Promise.all([lstat(this.rootPath), lstat(objectsRoot)]);
    if (rootStats.isSymbolicLink() || objectsStats.isSymbolicLink() || !objectsStats.isDirectory()) return void 0;
    const [physicalRoot, physicalObjects] = await Promise.all([realpath(this.rootPath), realpath(objectsRoot)]);
    const objectsRelative = relative(physicalRoot, physicalObjects);
    if (objectsRelative.startsWith("..") || isAbsolute(objectsRelative)) return void 0;
    const objectPath = this.objectPath(id);
    if (create) await mkdir(objectPath);
    let objectStats;
    try {
      objectStats = await lstat(objectPath);
    } catch (error) {
      if (hasCode(error, "ENOENT")) return void 0;
      throw error;
    }
    if (objectStats.isSymbolicLink() || !objectStats.isDirectory()) return void 0;
    const physicalObject = await realpath(objectPath);
    const objectRelative = relative(physicalObjects, physicalObject);
    if (objectRelative.startsWith("..") || isAbsolute(objectRelative)) return void 0;
    return objectPath;
  }
  isValidEntry(value) {
    if (!value || typeof value !== "object") return false;
    const entry = value;
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return typeof entry.id === "string" && uuid.test(entry.id) && typeof entry.itemId === "string" && typeof entry.ruleId === "string" && typeof entry.originalPath === "string" && isAbsolute(entry.originalPath) && typeof entry.storedPath === "string" && resolve(entry.storedPath) === resolve(this.storedPath(entry.id)) && typeof entry.sizeBytes === "number" && Number.isFinite(entry.sizeBytes) && entry.sizeBytes >= 0 && typeof entry.sha256 === "string" && /^[0-9a-f]{64}$/.test(entry.sha256) && typeof entry.fileMode === "number" && Number.isInteger(entry.fileMode) && typeof entry.modifiedAt === "string" && Number.isFinite(Date.parse(entry.modifiedAt)) && typeof entry.accessedAt === "string" && Number.isFinite(Date.parse(entry.accessedAt)) && typeof entry.createdAt === "string" && Number.isFinite(Date.parse(entry.createdAt)) && typeof entry.expiresAt === "string" && Number.isFinite(Date.parse(entry.expiresAt));
  }
  async readEntries() {
    const value = await this.store.read();
    return Array.isArray(value) ? value.filter((entry) => this.isValidEntry(entry)) : [];
  }
  list() {
    return this.serial.run(() => this.readEntries());
  }
  quarantine(item) {
    return this.serial.run(async () => {
      const id = randomUUID();
      const objectPath = await this.safeObjectDirectory(id, true);
      if (!objectPath) throw new Error("unsafe-quarantine-storage");
      const storedPath = join(objectPath, "payload");
      const createdAt = this.now();
      const stats = await lstat(item.path);
      if (!stats.isFile() || stats.isSymbolicLink()) throw new Error("invalid-quarantine-source");
      const entry = {
        id,
        itemId: item.id,
        ruleId: item.ruleId,
        originalPath: item.path,
        storedPath,
        sizeBytes: stats.size,
        sha256: await hashFile(item.path),
        fileMode: stats.mode,
        modifiedAt: stats.mtime.toISOString(),
        accessedAt: stats.atime.toISOString(),
        createdAt: createdAt.toISOString(),
        expiresAt: new Date(createdAt.getTime() + 7 * 24 * 60 * 60 * 1e3).toISOString()
      };
      await moveFile(item.path, storedPath);
      try {
        await this.store.update((entries) => [...entries.filter((candidate) => this.isValidEntry(candidate)), entry]);
        return entry;
      } catch (error) {
        await moveFile(storedPath, item.path);
        try {
          await rmdir(objectPath);
        } catch {
        }
        throw error;
      }
    });
  }
  restore(id) {
    return this.serial.run(async () => {
      const entries = await this.readEntries();
      const entry = entries.find((candidate) => candidate.id === id);
      if (!entry) return { restored: false, reason: "not-found" };
      if (!this.options.isRestoreTargetAllowed || !await this.options.isRestoreTargetAllowed(entry)) {
        return { restored: false, reason: "unsafe-target" };
      }
      const objectPath = await this.safeObjectDirectory(entry.id, false);
      if (!objectPath) return { restored: false, reason: "unsafe-storage" };
      const source = join(objectPath, "payload");
      try {
        const sourceStats = await lstat(source);
        if (sourceStats.isSymbolicLink() || !sourceStats.isFile()) return { restored: false, reason: "unsafe-storage" };
        if (await hashFile(source) !== entry.sha256) return { restored: false, reason: "integrity-check-failed" };
        await restoreFileExclusive(source, entry.originalPath, entry);
      } catch (error) {
        if (hasCode(error, "EEXIST")) return { restored: false, reason: "target-exists" };
        if (hasCode(error, "ENOENT")) return { restored: false, reason: "payload-missing" };
        if (error instanceof Error && error.message === "integrity-check-failed") {
          return { restored: false, reason: "integrity-check-failed" };
        }
        throw error;
      }
      await this.store.update((current) => current.filter((candidate) => this.isValidEntry(candidate) && candidate.id !== id));
      try {
        await rmdir(objectPath);
      } catch {
      }
      return { restored: true, path: entry.originalPath };
    });
  }
  purgeExpired(now = this.now()) {
    return this.serial.run(async () => {
      const entries = await this.readEntries();
      const expired = entries.filter((entry) => Date.parse(entry.expiresAt) <= now.getTime());
      const purged = [];
      for (const entry of expired) {
        const objectPath = await this.safeObjectDirectory(entry.id, false);
        if (!objectPath) continue;
        const payloadPath = join(objectPath, "payload");
        try {
          const payloadStats = await lstat(payloadPath);
          if (payloadStats.isDirectory()) continue;
          await unlink(payloadPath);
          try {
            await rmdir(objectPath);
          } catch {
          }
          purged.push(entry);
        } catch (error) {
          if (!hasCode(error, "ENOENT")) throw error;
        }
      }
      await this.store.write(entries.filter((entry) => Date.parse(entry.expiresAt) > now.getTime()));
      return {
        purgedCount: purged.length,
        purgedBytes: purged.reduce((sum, entry) => sum + entry.sizeBytes, 0)
      };
    });
  }
}

export {
  hashFile,
  moveFile,
  QuarantineService
};
