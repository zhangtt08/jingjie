/**
 * storage.js -- recovered from the packaged main bundle (electron-vite output, out/main/main.js).
 * crash-safe JSON store + serial executors (one destructive writer each).
 * Provenance: see docs/SOURCE-RECOVERY.md. Slices are byte-identical to the bundle except for
 * the documented symbol renames (esbuild added $1/$2 suffixes to duplicate names).
 */
import { win32, join, dirname, resolve, isAbsolute, parse, relative, basename } from "node:path";
import { lstat, realpath, readFile, mkdir, open, rm, rename, rmdir, unlink, copyFile, chmod, utimes, opendir, access, readdir, stat } from "node:fs/promises";
import { randomUUID, createHash } from "node:crypto";
function hasCodeOnce(error, code) {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}
class AtomicJsonStore {
  constructor(filePath, emptyValue) {
    this.filePath = filePath;
    this.emptyValue = emptyValue;
  }
  filePath;
  emptyValue;
  queue = Promise.resolve();
  enqueue(operation) {
    const result = this.queue.then(operation, operation);
    this.queue = result.then(() => void 0, () => void 0);
    return result;
  }
  async readFileValue(filePath) {
    return JSON.parse(await readFile(filePath, "utf8"));
  }
  async readUnsafe() {
    try {
      return await this.readFileValue(this.filePath);
    } catch (primaryError) {
      try {
        return await this.readFileValue(`${this.filePath}.pending-backup`);
      } catch {
        try {
          return await this.readFileValue(`${this.filePath}.bak`);
        } catch {
          if (hasCodeOnce(primaryError, "ENOENT")) return structuredClone(this.emptyValue);
          throw primaryError;
        }
      }
    }
  }
  async writeUnsafe(value) {
    await mkdir(dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.${randomUUID()}.tmp`;
    const backupPath = `${this.filePath}.bak`;
    const pendingBackupPath = `${this.filePath}.pending-backup`;
    const corruptPath = `${this.filePath}.corrupt`;
    const handle = await open(temporaryPath, "wx");
    try {
      try {
        await handle.writeFile(JSON.stringify(value, null, 2), "utf8");
        await handle.sync();
      } finally {
        await handle.close();
      }
    } catch (error) {
      await rm(temporaryPath, { force: true });
      throw error;
    }
    let primaryMoved = false;
    let corruptPrimaryMoved = false;
    try {
      try {
        await this.readFileValue(this.filePath);
        await rm(pendingBackupPath, { force: true });
        await rename(this.filePath, pendingBackupPath);
        primaryMoved = true;
      } catch (error) {
        if (!hasCodeOnce(error, "ENOENT")) {
          await rm(corruptPath, { force: true });
          try {
            await rename(this.filePath, corruptPath);
            corruptPrimaryMoved = true;
          } catch (renameError) {
            if (!hasCodeOnce(renameError, "ENOENT")) throw renameError;
          }
        }
      }
      await rename(temporaryPath, this.filePath);
      if (primaryMoved) {
        try {
          await rm(backupPath, { force: true });
          await rename(pendingBackupPath, backupPath);
        } catch {
        }
      }
      if (corruptPrimaryMoved) await rm(corruptPath, { force: true });
    } catch (error) {
      await rm(temporaryPath, { force: true });
      if (primaryMoved) {
        try {
          await rename(pendingBackupPath, this.filePath);
        } catch {
        }
      } else if (corruptPrimaryMoved) {
        try {
          await rename(corruptPath, this.filePath);
        } catch {
        }
      }
      throw error;
    }
  }
  read() {
    return this.enqueue(() => this.readUnsafe());
  }
  write(value) {
    return this.enqueue(() => this.writeUnsafe(value));
  }
  update(mutator) {
    return this.enqueue(async () => {
      const next = await mutator(await this.readUnsafe());
      await this.writeUnsafe(next);
      return next;
    });
  }
}
class SerialExecutor {
  queue = Promise.resolve();
  run(operation) {
    const result = this.queue.then(operation, operation);
    this.queue = result.then(() => void 0, () => void 0);
    return result;
  }
}
function hasCode(error, ...codes) {
  return typeof error === "object" && error !== null && "code" in error && codes.includes(String(error.code));
}

export {
  AtomicJsonStore,
  SerialExecutor,
  hasCode
};
