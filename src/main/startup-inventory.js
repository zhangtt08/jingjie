/**
 * startup-inventory.js -- recovered from the packaged main bundle (electron-vite output, out/main/main.js).
 * startup entry normalisation (registry / startup folder / scheduled task).
 * Provenance: see docs/SOURCE-RECOVERY.md. Slices are byte-identical to the bundle except for
 * the documented symbol renames (esbuild added $1/$2 suffixes to duplicate names).
 */
import { win32, join, dirname, resolve, isAbsolute, parse, relative, basename } from "node:path";
import { randomUUID, createHash } from "node:crypto";
function text(value) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}
function identity(record) {
  if (record.source === "registry") {
    if (!record.registryHive || !text(record.registryKey) || !text(record.registryValueName)) return null;
    return `${record.registryHive}\0${text(record.registryKey)}\0${text(record.registryValueName)}`;
  }
  if (record.source === "startup-folder") return text(record.filePath);
  return text(record.taskPath);
}
function isReversibleRecord(record) {
  if (!text(record.name) || !text(record.command) || !identity(record)) return false;
  if (record.source === "registry") {
    return Boolean(record.registryView && record.registryValueKind);
  }
  if (record.source === "startup-folder") {
    return typeof record.fileSize === "number" && record.fileSize >= 0 && Boolean(text(record.fileModifiedAt));
  }
  return record.taskEnabled !== null && record.taskActions.length > 0;
}
function dedupeKey(record) {
  return `${record.source}\0${identity(record).toLocaleLowerCase("en-US")}`;
}
function richness(record) {
  return [record.publisher, record.executablePath, record.fileModifiedAt, ...record.taskActions].filter((value) => text(value) !== null).length;
}
function impact(source) {
  if (source === "startup-folder") return { impact: "low", reasons: ["startup-folder-item"] };
  if (source === "scheduled-task") return { impact: "medium", reasons: ["logon-scheduled-task"] };
  return { impact: "medium", reasons: ["registry-autostart"] };
}
function normalize(record) {
  const sourceIdentity = identity(record);
  const impactDecision = impact(record.source);
  return {
    ...record,
    id: createHash("sha256").update(`${record.source}\0${sourceIdentity.toLocaleLowerCase("en-US")}`).digest("hex").slice(0, 24),
    name: text(record.name),
    command: text(record.command),
    publisher: text(record.publisher),
    executablePath: text(record.executablePath),
    registryKey: text(record.registryKey),
    registryValueName: text(record.registryValueName),
    filePath: text(record.filePath),
    fileModifiedAt: text(record.fileModifiedAt),
    taskPath: text(record.taskPath),
    taskActions: record.taskActions.map((action) => action.trim()).filter(Boolean),
    impact: impactDecision.impact,
    impactReasons: impactDecision.reasons,
    protected: false,
    protectedReasons: [],
    canDisable: true
  };
}
function normalizeStartupEntries(records) {
  const chosen = /* @__PURE__ */ new Map();
  for (const record of records) {
    if (!isReversibleRecord(record)) continue;
    const key = dedupeKey(record);
    const current = chosen.get(key);
    if (!current || richness(record) > richness(current)) chosen.set(key, record);
  }
  return [...chosen.values()].map(normalize).sort((left, right) => left.name.localeCompare(right.name, "zh-CN"));
}

export {
  normalizeStartupEntries,
  isReversibleRecord
};
