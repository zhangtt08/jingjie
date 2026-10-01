/**
 * software-inventory.js -- recovered from the packaged main bundle (electron-vite output, out/main/main.js).
 * registry + appx inventory normalisation and dedupe.
 * Provenance: see docs/SOURCE-RECOVERY.md. Slices are byte-identical to the bundle except for
 * the documented symbol renames (esbuild added $1/$2 suffixes to duplicate names).
 */
import { win32, join, dirname, resolve, isAbsolute, parse, relative, basename } from "node:path";
import { randomUUID, createHash } from "node:crypto";
function trimText(value) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}
function identityFor(record) {
  return trimText(record.productCode) ?? trimText(record.packageFullName) ?? trimText(record.registryKey) ?? `${trimText(record.displayName) ?? ""}\0${trimText(record.publisher) ?? ""}\0${trimText(record.uninstallString) ?? ""}`;
}
function softwareDedupeKey(record) {
  const identity2 = identityFor(record).toLocaleLowerCase("en-US");
  return `${record.source}\0${identity2}`;
}
function softwareRichness(record) {
  return [record.publisher, record.displayVersion, record.installLocation, record.quietUninstallString, record.uninstallString].filter((value) => trimText(value) !== null).length;
}
function uninstallKind(record) {
  if (record.source === "appx" && trimText(record.packageFullName)) return "appx";
  if (record.windowsInstaller || trimText(record.productCode)) return "msi";
  if (trimText(record.quietUninstallString) || trimText(record.uninstallString)) return "exe";
  return "none";
}
function normalizeRecord(record) {
  const identity2 = identityFor(record);
  const id = createHash("sha256").update(`${record.source}\0${identity2.toLocaleLowerCase("en-US")}`).digest("hex").slice(0, 24);
  const estimatedSizeKb = typeof record.estimatedSizeKb === "number" && Number.isFinite(record.estimatedSizeKb) ? Math.max(0, record.estimatedSizeKb) : null;
  return {
    id,
    source: record.source,
    scope: record.scope,
    registryView: record.registryView,
    registryKey: trimText(record.registryKey),
    name: trimText(record.displayName),
    publisher: trimText(record.publisher),
    version: trimText(record.displayVersion),
    installLocation: trimText(record.installLocation),
    installDate: trimText(record.installDate),
    estimatedSizeBytes: estimatedSizeKb === null ? null : Math.round(estimatedSizeKb * 1024),
    uninstallKind: uninstallKind(record),
    identity: identity2,
    uninstallString: trimText(record.uninstallString),
    quietUninstallString: trimText(record.quietUninstallString),
    windowsInstaller: record.windowsInstaller,
    systemComponent: record.systemComponent,
    productCode: trimText(record.productCode),
    packageFullName: trimText(record.packageFullName),
    risk: "ordinary",
    protectedReasons: [],
    standardUninstallAllowed: false,
    forceRemovalAllowed: false
  };
}
function normalizeInstalledSoftware(records) {
  const chosen = /* @__PURE__ */ new Map();
  for (const record of records) {
    if (!trimText(record.displayName)) continue;
    const key = softwareDedupeKey(record);
    const current = chosen.get(key);
    if (!current || softwareRichness(record) > softwareRichness(current)) chosen.set(key, record);
  }
  return [...chosen.values()].map(normalizeRecord).sort((left, right) => left.name.localeCompare(right.name, "zh-CN"));
}

export {
  normalizeInstalledSoftware,
  uninstallKind
};
