#!/usr/bin/env node
/**
 * extract-asar.mjs — 零依赖 .asar 归档解包器（只用 Node 内置模块）
 *
 * 为什么存在：本仓库最初只有一份安装产物（resources/app.asar），没有源码仓库。
 * 为了不安装任何新依赖（用户明确要求），这里按 asar 磁盘格式自己解析：
 *
 *   asar 磁盘布局
 *   ┌──────────────────────────────────────────────────────────────┐
 *   │ 0  : UInt32LE  = 4                （尺寸块 payloadSize）      │
 *   │ 4  : UInt32LE  = headerBlockLen   （头部块字节数，含对齐填充） │
 *   │ 8  : UInt32LE  = payloadSize = headerBlockLen - 4            │
 *   │ 12 : UInt32LE  = jsonLen          （目录 JSON 的 UTF-8 字节数）│
 *   │ 16 : jsonLen 字节的 JSON + 填充到 4 字节对齐                  │
 *   │ 8 + headerBlockLen : 文件内容区（各文件 offset 相对于此）      │
 *   └──────────────────────────────────────────────────────────────┘
 *   这是 Chromium Pickle 的两层嵌套：外层 writeUInt32(headerBlockLen)，
 *   内层 writeString(dirJson)。因此上面 4/12 两个字段才是真正的长度。
 *
 *   目录 JSON 形状：
 *     目录  { "files": { "<name>": <node>, ... } }
 *     文件  { "size": n, "offset": "<十进制字符串>",
 *             "integrity": { "algorithm":"SHA256","hash":"<hex>",
 *                            "blockSize":4194304, "blocks":["<hex>", ...] },
 *             "unpacked"?: true, "exec"?: true }
 *     符号链接 { "link": "<相对路径>" }（本归档没有，仍实现）
 *
 * 校验：每个文件解出后按头部 integrity.hash 现算 SHA-256 比对，逐个计数，
 * 不做“看起来对了”的假设。--verify 失败会退出非 0 并列出损坏项。
 *
 * 用法：
 *   node tools/extract-asar.mjs <archive.asar> <outDir> [--verify] [--list] [--quiet]
 *
 * 约定：stdout 只用 ASCII（Windows 控制台 GBK 下中文会乱码，见 docs/RUNBOOK.md）。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const ASCII_SAFE = /^[\x20-\x7e\r\n\t]*$/;
function say(line) {
  process.stdout.write(ASCII_SAFE.test(line) ? line : line.replace(/[^\x20-\x7e\n\r\t]/g, '?'));
  process.stdout.write('\n');
}

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
const positional = args.filter((a) => !a.startsWith('--'));
const archivePath = positional[0];
const outDir = positional[1];
const LIST = flags.has('--list');
const QUIET = flags.has('--quiet');

if (!archivePath) {
  say('usage: node tools/extract-asar.mjs <archive.asar> <outDir> [--verify] [--list] [--quiet]');
  process.exit(2);
}
if (!LIST && !outDir) {
  say('error: outDir is required unless --list is used');
  process.exit(2);
}

const fd = fs.openSync(archivePath, 'r');
try {
  const st = fs.fstatSync(fd);
  if (st.size < 16) throw new Error('file too small to be an asar archive');

  const preamble = Buffer.alloc(8);
  readAt(fd, preamble, 0, 8, 0);
  const outerPayloadSize = preamble.readUInt32LE(0);
  const headerBlockLen = preamble.readUInt32LE(4);
  if (outerPayloadSize !== 4) {
    say(`warn: outer pickle payloadSize is ${outerPayloadSize}, expected 4 (format may differ)`);
  }
  if (8 + headerBlockLen > st.size) throw new Error('header block overruns archive size');

  const headerBlock = Buffer.alloc(headerBlockLen);
  readAt(fd, headerBlock, 0, headerBlockLen, 8);
  const innerPayloadSize = headerBlock.readUInt32LE(0);
  const jsonLen = headerBlock.readUInt32LE(4);
  if (4 + innerPayloadSize !== headerBlockLen) {
    say(`warn: inner payloadSize ${innerPayloadSize} + 4 != headerBlockLen ${headerBlockLen}`);
  }
  if (8 + jsonLen > headerBlockLen) throw new Error('header string overruns header block');

  const headerJson = headerBlock.slice(8, 8 + jsonLen).toString('utf8');
  const tree = JSON.parse(headerJson); // 抛错即说明长度取错了，绝不静默继续
  const dataStart = 8 + headerBlockLen;
  const dataRegion = st.size - dataStart;

  // ---- 统计目录树 -------------------------------------------------------
  let fileCount = 0;
  let dirCount = 0;
  let linkCount = 0;
  let unpackedCount = 0;
  let sumSizes = 0;
  let maxEnd = 0;
  const entries = [];
  (function walk(node, p) {
    if (node && node.files) {
      dirCount += 1;
      for (const [name, child] of Object.entries(node.files)) {
        assertSafeName(name, p);
        walk(child, `${p}/${name}`);
      }
      return;
    }
    if (node && typeof node.link === 'string') {
      linkCount += 1;
      entries.push({ type: 'link', path: p, link: node.link });
      return;
    }
    if (!node || typeof node.size !== 'number') throw new Error(`unknown node at ${p || '/'}: ${JSON.stringify(node).slice(0, 120)}`);
    const offset = Number(node.offset);
    if (!Number.isSafeInteger(offset) || offset < 0) throw new Error(`bad offset at ${p}`);
    if (node.unpacked) unpackedCount += 1;
    fileCount += 1;
    sumSizes += node.size;
    maxEnd = Math.max(maxEnd, offset + node.size);
    entries.push({ type: 'file', path: p, size: node.size, offset, integrity: node.integrity, exec: node.exec === true, unpacked: node.unpacked === true });
  })(tree, '');

  if (!QUIET) {
    say(`archive          : ${archivePath}`);
    say(`archive bytes    : ${st.size}`);
    say(`header block     : ${headerBlockLen} bytes (json ${jsonLen} bytes at 16)`);
    say(`data start       : ${dataStart}`);
    say(`data region      : ${dataRegion}`);
    say(`sum of file sizes: ${sumSizes}`);
    say(`last byte used   : ${maxEnd}`);
    say(`layout check     : ${dataRegion === maxEnd && sumSizes === maxEnd ? 'OK (sizes tile the data region exactly)' : `MISMATCH dataRegion=${dataRegion} maxEnd=${maxEnd} sum=${sumSizes}`}`);
    say(`entries          : files=${fileCount} dirs=${dirCount} symlinks=${linkCount} unpackedRefs=${unpackedCount}`);
  }

  if (LIST) {
    for (const e of entries) say(`${e.type === 'file' ? 'f' : e.type === 'link' ? 'l' : 'd'}\t${e.type === 'file' ? e.size : 0}\t${e.path}`);
    if (!QUIET) say(`listed ${entries.length} entries`);
    process.exit(0);
  }

  // ---- 解包 -------------------------------------------------------------
  fs.mkdirSync(outDir, { recursive: true });
  const unpackedSrc = `${archivePath}.unpacked`;
  const hasUnpackedDir = fs.existsSync(unpackedSrc);
  let written = 0;
  let verified = 0;
  const bad = [];
  const skippedUnpacked = [];
  let bytesWritten = 0;

  for (const e of entries) {
    const dest = path.join(outDir, ...e.path.split('/').filter(Boolean));
    if (e.type === 'link') {
      skippedUnpacked.push(`symlink ${e.path} -> ${e.link} (materialized as text note)`);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(`${dest}.asar-link.txt`, `this entry was a symlink inside the archive pointing to: ${e.link}\n`);
      continue;
    }
    if (e.unpacked && hasUnpackedDir) {
      const loose = path.join(unpackedSrc, ...e.path.split('/').filter(Boolean));
      if (fs.existsSync(loose)) {
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(loose, dest);
        written += 1;
        bytesWritten += fs.statSync(dest).size;
        if (flags.has('--verify')) verifyOne(dest, e, bad, (n) => (verified += n));
        continue;
      }
    }
    const buf = Buffer.alloc(e.size);
    if (e.size > 0) readAt(fd, buf, 0, e.size, dataStart + e.offset);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, buf);
    if (e.exec) {
      try { fs.chmodSync(dest, 0o755); } catch { /* Windows 上 exec 位无意义 */ }
    }
    written += 1;
    bytesWritten += buf.length;
    if (flags.has('--verify')) verifyOne(dest, e, bad, (n) => (verified += n));
  }

  function verifyOne(filePath, e, badList, onOk) {
    const want = e.integrity && e.integrity.hash;
    if (!want) return;
    const got = crypto.createHash(e.integrity.algorithm || 'sha256').update(fs.readFileSync(filePath)).digest('hex');
    if (got === want) onOk(1);
    else badList.push(`${e.path}: expected ${want} got ${got}`);
  }

  if (!QUIET) {
    say(`written files    : ${written} (${bytesWritten} bytes) -> ${outDir}`);
    if (flags.has('--verify')) say(`integrity verified: ${verified}, corrupt: ${bad.length}`);
    for (const b of bad) say(`CORRUPT ${b}`);
    for (const s of skippedUnpacked) say(`note: ${s}`);
  }
  if (bad.length) process.exit(1);
} finally {
  fs.closeSync(fd);
}

function readAt(fd, buf, offset, length, position) {
  const got = fs.readSync(fd, buf, offset, length, position);
  if (got !== length) throw new Error(`short read: wanted ${length} at position ${position}, got ${got}`);
}

function assertSafeName(name, parent) {
  if (name === '' || name === '.' || name === '..' || name.includes('/') || name.includes('\\') || /[\0<>|:*?"]/.test(name)) {
    throw new Error(`unsafe entry name ${JSON.stringify(name)} under ${parent || '/'}`);
  }
}
