/**
 * protected-roots.js -- recovered from the packaged main bundle (electron-vite output, out/main/main.js).
 * personal folders + cloud sync roots resolution, lexical and physical.
 * Provenance: see docs/SOURCE-RECOVERY.md. Slices are byte-identical to the bundle except for
 * the documented symbol renames (esbuild added $1/$2 suffixes to duplicate names).
 */
import { win32, join, dirname, resolve, isAbsolute, parse, relative, basename } from "node:path";
import { createReadStream, constants, realpathSync } from "node:fs";
import { lstat, realpath, readFile, mkdir, open, rm, rename, rmdir, unlink, copyFile, chmod, utimes, opendir, access, readdir, stat } from "node:fs/promises";
function canonicalPath(value) {
  const withoutDevicePrefix = value.startsWith("\\\\?\\UNC\\") ? `\\\\${value.slice(8)}` : value.startsWith("\\\\?\\") ? value.slice(4) : value;
  return win32.resolve(withoutDevicePrefix).replace(/[\\/]+$/, "").toLocaleLowerCase("en-US");
}
function isAtOrBelowPath(candidate, root) {
  return candidate === root || candidate.startsWith(`${root}\\`);
}
function uniqueAbsolute(values) {
  return [...new Set(values.filter((value) => value && win32.isAbsolute(value)).map((value) => win32.resolve(value)))];
}
async function resolveProtectedRoots(source) {
  const personalFolders = uniqueAbsolute(source.personalFolders);
  const cloudRoots = uniqueAbsolute(source.cloudRoots);
  const lexical = uniqueAbsolute([...personalFolders, ...cloudRoots]);
  const physical = [];
  for (const root of lexical) {
    try {
      const resolved = await realpath(root);
      const stats = await lstat(resolved);
      if (stats.isDirectory()) physical.push(win32.resolve(resolved));
    } catch {
    }
  }
  return {
    personalFolders,
    cloudRoots,
    lexicalRoots: [...new Set(lexical.map(canonicalPath))],
    physicalRoots: [...new Set(physical.map(canonicalPath))]
  };
}
function isProtectedPath(candidatePath, roots) {
  if (!candidatePath || !win32.isAbsolute(candidatePath)) return true;
  const candidate = canonicalPath(candidatePath);
  if ([...roots.lexicalRoots, ...roots.physicalRoots].some((root) => isAtOrBelowPath(candidate, root))) return true;
  let ancestor = win32.resolve(candidatePath);
  while (true) {
    try {
      const resolvedAncestor = realpathSync.native(ancestor);
      const suffix = win32.relative(ancestor, win32.resolve(candidatePath));
      const physicalCandidate = canonicalPath(win32.join(resolvedAncestor, suffix));
      return roots.physicalRoots.some((root) => isAtOrBelowPath(physicalCandidate, root));
    } catch {
      const parent = win32.dirname(ancestor);
      if (parent === ancestor) return false;
      ancestor = parent;
    }
  }
}
async function isDirectory(value) {
  try {
    return (await stat(value)).isDirectory();
  } catch {
    return false;
  }
}
async function physicalPathIsProtected(value, protectedRootsArg) {
  if (isProtectedPath(value, protectedRootsArg)) return true;
  try {
    return isProtectedPath(await realpath(value), protectedRootsArg);
  } catch {
    return true;
  }
}

export {
  resolveProtectedRoots,
  isProtectedPath,
  isDirectory,
  physicalPathIsProtected,
  uniqueAbsolute
};
