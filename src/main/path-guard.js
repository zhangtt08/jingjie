/**
 * path-guard.js -- recovered from the packaged main bundle (electron-vite output, out/main/main.js).
 * the single safety boundary: rule-root allowlist, protected roots, symlink/junction rejection, physical (realpath) re-check.
 * Provenance: see docs/SOURCE-RECOVERY.md. Slices are byte-identical to the bundle except for
 * the documented symbol renames (esbuild added $1/$2 suffixes to duplicate names).
 */
import { win32, join, dirname, resolve, isAbsolute, parse, relative, basename } from "node:path";
import { lstat, realpath } from "node:fs/promises";
const PERSONAL_FOLDERS = ["Desktop", "Documents", "Downloads", "Pictures", "Videos", "Music", "OneDrive"];
function canonicalRule(value) {
  return win32.resolve(value).replace(/[\\/]+$/, "").toLocaleLowerCase("en-US");
}
function isAtOrBelowRule(candidate, root) {
  return candidate === root || candidate.startsWith(`${root}\\`);
}
function isVolumeRoot(value) {
  const normalized = canonicalRule(value);
  return normalized === canonicalRule(win32.parse(value).root);
}
function environmentIsSafe(env) {
  if (![env.userProfile, env.localAppData, env.tempRoot, env.windowsRoot].every(win32.isAbsolute)) return false;
  if (isVolumeRoot(env.userProfile) || isVolumeRoot(env.localAppData) || isVolumeRoot(env.tempRoot) || isVolumeRoot(env.windowsRoot)) return false;
  if (canonicalRule(env.localAppData) !== canonicalRule(win32.join(env.userProfile, "AppData", "Local"))) return false;
  if (canonicalRule(env.tempRoot) !== canonicalRule(win32.join(env.localAppData, "Temp"))) return false;
  return win32.basename(env.windowsRoot).toLocaleLowerCase("en-US") === "windows";
}
function expectedRuleRoot(ruleId, env) {
  const roots = {
    "user-temp": env.tempRoot,
    "windows-temp": win32.join(env.windowsRoot, "Temp"),
    "crash-dumps": win32.join(env.localAppData, "CrashDumps"),
    "wer-reports": win32.join(env.localAppData, "Microsoft", "Windows", "WER", "ReportArchive"),
    "edge-cache": win32.join(env.localAppData, "Microsoft", "Edge", "User Data", "Default", "Cache", "Cache_Data"),
    "chrome-cache": win32.join(env.localAppData, "Google", "Chrome", "User Data", "Default", "Cache", "Cache_Data")
  };
  return roots[ruleId];
}
function trustedRuleAnchor(rule, env) {
  return rule.id === "windows-temp" ? env.windowsRoot : env.userProfile;
}
function evaluateRuleRoot(rule, env) {
  const expected = environmentIsSafe(env) ? expectedRuleRoot(rule.id, env) : void 0;
  if (!expected || !win32.isAbsolute(rule.root) || canonicalRule(rule.root) !== canonicalRule(expected)) {
    return { allowed: false, reason: "unsafe-rule-root" };
  }
  return { allowed: true, normalizedPath: win32.resolve(rule.root) };
}
async function evaluatePhysicalRuleRoot(rule, env) {
  const decision = evaluateRuleRoot(rule, env);
  if (!decision.allowed) return decision;
  const anchor = win32.resolve(trustedRuleAnchor(rule, env));
  const relativeRoot = win32.relative(anchor, decision.normalizedPath);
  if (relativeRoot.startsWith("..") || win32.isAbsolute(relativeRoot)) {
    return { allowed: false, reason: "unsafe-rule-root" };
  }
  const chain = [anchor];
  let current = anchor;
  for (const segment of relativeRoot.split("\\").filter(Boolean)) {
    current = win32.join(current, segment);
    chain.push(current);
  }
  for (const directory of chain) {
    const stats = await lstat(directory);
    if (stats.isSymbolicLink() || !stats.isDirectory()) return { allowed: false, reason: "symbolic-link" };
  }
  const [physicalAnchor, physicalRoot] = await Promise.all([realpath(anchor), realpath(decision.normalizedPath)]);
  if (!isAtOrBelowRule(canonicalRule(physicalRoot), canonicalRule(physicalAnchor))) {
    return { allowed: false, reason: "outside-rule-root" };
  }
  return { allowed: true, normalizedPath: decision.normalizedPath };
}
function protectedRoots(env) {
  return [
    ...PERSONAL_FOLDERS.map((folder) => win32.join(env.userProfile, folder)),
    win32.join(env.windowsRoot, "System32"),
    win32.join(env.windowsRoot, "WinSxS"),
    win32.join(env.windowsRoot, "System32", "DriverStore")
  ].map(canonicalRule);
}
function evaluatePath(candidatePath, rule, env, metadata = {}) {
  if (!candidatePath || candidatePath.includes("\0") || !win32.isAbsolute(candidatePath)) {
    return { allowed: false, reason: "invalid-path" };
  }
  const ruleRootDecision = evaluateRuleRoot(rule, env);
  if (!ruleRootDecision.allowed) return ruleRootDecision;
  if (metadata.isSymbolicLink) return { allowed: false, reason: "symbolic-link" };
  const normalizedCandidate = win32.resolve(candidatePath);
  const candidate = canonicalRule(normalizedCandidate);
  const root = canonicalRule(rule.root);
  if (candidate === root) return { allowed: false, reason: "rule-root" };
  if (!isAtOrBelowRule(candidate, root)) return { allowed: false, reason: "outside-rule-root" };
  if (protectedRoots(env).some((protectedRoot) => isAtOrBelowRule(candidate, protectedRoot))) {
    return { allowed: false, reason: "protected-root" };
  }
  return { allowed: true, normalizedPath: normalizedCandidate };
}
async function evaluatePhysicalPath(candidatePath, rule, env) {
  const lexicalDecision = evaluatePath(candidatePath, rule, env);
  if (!lexicalDecision.allowed) return lexicalDecision;
  const rootDecision = await evaluatePhysicalRuleRoot(rule, env);
  if (!rootDecision.allowed) return rootDecision;
  let current = lexicalDecision.normalizedPath;
  const normalizedRoot = rootDecision.normalizedPath;
  while (true) {
    const stats = await lstat(current);
    if (stats.isSymbolicLink()) return { allowed: false, reason: "symbolic-link" };
    if (canonicalRule(current) === canonicalRule(normalizedRoot)) break;
    const parent = win32.dirname(current);
    if (parent === current || !isAtOrBelowRule(canonicalRule(parent), canonicalRule(normalizedRoot))) {
      return { allowed: false, reason: "outside-rule-root" };
    }
    current = parent;
  }
  const [physicalCandidate, physicalRoot] = await Promise.all([
    realpath(lexicalDecision.normalizedPath),
    realpath(normalizedRoot)
  ]);
  if (!isAtOrBelowRule(canonicalRule(physicalCandidate), canonicalRule(physicalRoot))) {
    return { allowed: false, reason: "outside-rule-root" };
  }
  return lexicalDecision;
}
async function evaluateRestoreTargetPath(candidatePath, rule, env) {
  const lexicalDecision = evaluatePath(candidatePath, rule, env);
  if (!lexicalDecision.allowed) return lexicalDecision;
  const parent = win32.dirname(lexicalDecision.normalizedPath);
  if (canonicalRule(parent) === canonicalRule(rule.root)) {
    const rootDecision = await evaluatePhysicalRuleRoot(rule, env);
    return rootDecision.allowed ? lexicalDecision : rootDecision;
  }
  const parentDecision = await evaluatePhysicalPath(parent, rule, env);
  return parentDecision.allowed ? lexicalDecision : parentDecision;
}

export {
  PERSONAL_FOLDERS,
  canonicalRule,
  isAtOrBelowRule,
  isVolumeRoot,
  environmentIsSafe,
  expectedRuleRoot,
  trustedRuleAnchor,
  evaluateRuleRoot,
  evaluatePhysicalRuleRoot,
  protectedRoots,
  evaluatePath,
  evaluatePhysicalPath,
  evaluateRestoreTargetPath
};
