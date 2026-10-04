/**
 * agent-guard.test.js —— 本机服务守卫的回归测试（ITEM 1 的靶子）。
 *
 * 每一条都写成"没有守卫就会红"的形状：起一个真服务，用真 socket / 真 fetch 打真端点，
 * 断言的是回执与落盘产物，不是源码里有没有某个词。
 * 破坏性判据用产物证明：plan_execute 若真跑过，dataRoot 里一定会出现 plan-history.json
 * （src/main/plan-controller.js 第 500 行 execute 收尾写它）—— 那个文件不在，就是没删过东西。
 *
 * 全程用临时目录当 %APPDATA%\jingjie 与账本根，既不碰用户真实 AppData，也不碰系统。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createConnection } from 'node:net';
import { mkdtempSync, rmSync, readFileSync, existsSync, statSync, realpathSync as fsRealpath } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hostAllowed, originAllowed, splitHostPort, tokenMatches, checkLocalGuard, localHeaders } from '../agent/local-guard.mjs';
import { jingjieAppDataDir, ensureAgentToken, readAgentToken } from '../agent/token-store.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TOKEN_HEADER = 'x-jingjie-token';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** 展开 8.3 短名与再解析点（Windows 上 %TEMP% 给的是 ADMINI~1，普通 realpath 不展开） */
const realPath = (p) => (typeof fsRealpath.native === 'function' ? fsRealpath.native(p) : fsRealpath(p));

// ---------------------------------------------------------------------------
// 纯判据（不打网络）：这几条钉的是"永不拿 Origin 去比请求自己的 Host"这条形状
// ---------------------------------------------------------------------------

test('Host 判据：只有逐字的本机回环 + 本服务端口才算数', () => {
  assert.equal(hostAllowed('127.0.0.1:8796', 8796), true);
  assert.equal(hostAllowed('localhost:8796', 8796), true);
  assert.equal(hostAllowed('[::1]:8796', 8796), true);
  assert.equal(hostAllowed('::1', 8796), false);            // 没端口就不是本服务的地址
  assert.equal(hostAllowed('127.0.0.1:8797', 8796), false); // 端口不是实际监听的那个
  assert.equal(hostAllowed('evil.example.com:8796', 8796), false);
  assert.equal(hostAllowed('127.0.0.1.evil.example.com:8796', 8796), false);
  assert.equal(hostAllowed('', 8796), false);
  assert.equal(hostAllowed(undefined, 8796), false);
  // Host 头可以带 scheme/路径（畸形请求），归一化后仍然要按同一把尺量
  assert.deepEqual(splitHostPort('http://evil.example.com:8796/x'), { host: 'evil.example.com', port: 8796 });
});

test('Origin 判据：只跟固定回环白名单比，绝不跟请求自己的 Host 比', () => {
  assert.equal(originAllowed(undefined), true);            // 命令行/桥不带 Origin：放行
  assert.equal(originAllowed(''), true);
  assert.equal(originAllowed('http://127.0.0.1:5173'), true);
  assert.equal(originAllowed('http://localhost:3000'), true);
  assert.equal(originAllowed('null'), false);              // sandbox iframe / file:// 页面
  assert.equal(originAllowed('file://'), false);
  assert.equal(originAllowed('https://evil.example.com'), false);
  assert.equal(originAllowed('http://evil.example.com:8796'), false);
  assert.equal(originAllowed('not-a-url'), false);
  // DNS rebinding 的形状：Origin 的主机名与请求自己的 Host 逐字相同，但它不是回环字面量 —— 必须拒
  const req = { method: 'POST', headers: { host: 'evil.example.com:8796', origin: 'http://evil.example.com:8796' } };
  const verdict = checkLocalGuard(req, { port: 8796, token: 't'.repeat(64) });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.code, 'HOST_NOT_ALLOWED');
});

test('令牌比较是定长时间的，且不给"空令牌"开后门', () => {
  const expected = 'a'.repeat(64);
  assert.equal(tokenMatches(expected, expected), true);
  assert.equal(tokenMatches('b'.repeat(64), expected), false);
  assert.equal(tokenMatches(undefined, expected), false);
  assert.equal(tokenMatches('', ''), false, '期望值为空时绝不能把"没带令牌"判成通过');
  assert.equal(tokenMatches('a'.repeat(64), 'a'.repeat(65)), false); // 长度不同也走得完（先各自哈希）
});

test('响应头工具会把通配 CORS 摘掉', () => {
  const headers = localHeaders({ 'access-control-allow-origin': '*', 'content-type': 'application/json' });
  assert.equal(headers['access-control-allow-origin'], undefined);
  assert.equal(headers['content-type'], 'application/json');
  assert.equal(headers['x-content-type-options'], 'nosniff');
});

// ---------------------------------------------------------------------------
// 令牌落盘：自动生成、0600、合法调用方零配置读得到
// ---------------------------------------------------------------------------

test('令牌自动生成并落盘 0600，第二次读的是同一份', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'jingjie-token-'));
  try {
    const env = { JINGJIE_APP_DATA_DIR: dir };
    assert.equal(readAgentToken(env), '', '还没有文件时读取方应当拿到空，而不是造一个');
    const first = ensureAgentToken(env);
    assert.ok(first.token.length >= 32, `令牌长度不够：${first.token.length}`);
    assert.equal(first.source, 'created');
    const file = path.join(dir, 'agent-api.token');
    assert.equal(existsSync(file), true, '令牌必须落盘，否则重启后桥读不到');
    const second = ensureAgentToken(env);
    assert.equal(second.token, first.token, '同一目录内不许每次启动换一份令牌');
    assert.equal(readAgentToken(env), first.token, '读取方与服务方必须是同一份判据');
    const mode = statSync(file).mode;
    if (process.platform === 'win32') {
      // Windows 上根本没有 POSIX 权限位：libuv 把可写文件一律报成 0o666，chmod 只映射只读位，
      // 所以"其他用户读不到"这种在本平台不成立的断言不能假称成立 —— 那只是把判据改成永不红。
      // 能机械核对的是代码这一侧的唯一自由量：令牌必须落在**每用户目录**里，
      // 不能落在仓库目录或 C:\ProgramData 那种多账号/多检出共享的位置。
      // （比较前一律 realpathSync.native：Windows 的 %TEMP% 给的是 8.3 短名 C:\Users\ADMINI~1\…，
      //   普通 realpathSync 不展开短名，直接字符串前缀比会把"在用户目录下"判成假。）
      const real = realPath(file).toLocaleLowerCase('en-US');
      const repo = realPath(ROOT).toLocaleLowerCase('en-US');
      const home = realPath(homedir()).toLocaleLowerCase('en-US');
      assert.ok(!real.startsWith(`${repo}${path.sep}`), `令牌不许写进仓库目录（会被检出/备份/同步带走）：${file}`);
      assert.ok(!real.startsWith('c:\\programdata'), `令牌不许写在机器级共享目录：${file}`);
      assert.ok(real.startsWith(home + path.sep) || real === home, `令牌所在目录必须在用户配置文件下：${file} 不在 ${home}`);
      assert.equal(jingjieAppDataDir({ APPDATA: 'C:\\Users\\me\\AppData\\Roaming' }).toLocaleLowerCase('en-US'),
        'c:\\users\\me\\appdata\\roaming\\jingjie', '每用户目录判据：APPDATA 在就用它');
      // 残留风险如实记在 agent/README.md：本机 %APPDATA% 带 CodexSandboxUsers 等组的 RX 继承，
      // 所以这台机器上"0600"只是代码的请求，不是系统给的保证。
    } else {
      assert.equal(mode & 0o077, 0, `组/其他权限位必须为 0：mode=${mode.toString(8)}`);
    }
    assert.equal(readAgentToken({ JINGJIE_AGENT_TOKEN: 'x'.repeat(64) }), 'x'.repeat(64), '环境变量优先于文件');
    assert.equal(ensureAgentToken({ JINGJIE_AGENT_TOKEN: 'x'.repeat(64), JINGJIE_APP_DATA_DIR: dir }).source, 'env');
    // 目录判据：APPDATA 在就用它，没有就回落 home —— 守卫与历史账本必须同一个来源
    assert.equal(jingjieAppDataDir({ JINGJIE_APP_DATA_DIR: dir }), dir);
    assert.equal(jingjieAppDataDir({ APPDATA: 'C:\\Users\\me\\AppData\\Roaming' }), path.join('C:\\Users\\me\\AppData\\Roaming', 'jingjie'));
    assert.equal(jingjieAppDataDir({}), path.join(homedir(), '.jingjie'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 起真服务打真端点
// ---------------------------------------------------------------------------

function rawRequest({ port, hostHeader, method = 'GET', path: p = '/api/health', headers = {}, body = null }) {
  return new Promise((resolve, reject) => {
    const conn = createConnection({ host: '127.0.0.1', port }, () => {
      const lines = [`${method} ${p} HTTP/1.1`, `Host: ${hostHeader}`, 'Connection: close'];
      const all = { ...headers };
      if (body !== null) { all['content-type'] = 'application/json'; all['content-length'] = Buffer.byteLength(body); }
      for (const [k, v] of Object.entries(all)) lines.push(`${k}: ${v}`);
      conn.end([...lines, '', body ?? ''].join('\r\n'));
    });
    let raw = '';
    conn.setEncoding('utf8');
    conn.on('data', (d) => { raw += d; });
    conn.on('end', () => {
      const split = raw.indexOf('\r\n\r\n');
      const head = split >= 0 ? raw.slice(0, split) : raw;
      const text = split >= 0 ? raw.slice(split + 4) : '';
      let consumed = 0;
      const want = Number(/content-length:\s*(\d+)/i.exec(head)?.[1] ?? NaN);
      if (Number.isFinite(want)) { consumed = text.length >= want ? want : text.length; }
      resolve({
        status: Number(/HTTP\/1\.[01] (\d{3})/.exec(head)?.[1] ?? 0),
        head,
        text: text.slice(0, consumed),
        json: (() => { try { return JSON.parse(text.slice(0, consumed)); } catch { return null; } })()
      });
    });
    conn.on('error', reject);
    conn.setTimeout(20000, () => { conn.destroy(); reject(new Error('raw 请求超时')); });
  });
}

/** 起一个真服务（独立临时 app-data 目录 + 独立账本目录），返回端点、令牌与收尾函数 */
async function withServer(run) {
  const dir = mkdtempSync(path.join(tmpdir(), 'jingjie-guard-'));
  const appData = path.join(dir, 'appdata');
  const dataRoot = path.join(dir, 'data');
  const port = 21000 + Math.floor(Math.random() * 4000);
  const env = {
    ...process.env,
    AGENT_PORT: String(port),
    JINGJIE_APP_DATA_DIR: appData,
    JINGJIE_DATA_ROOT: dataRoot,
    ELECTRON_RUN_AS_NODE: '1'
  };
  // 本用例要验的就是"零配置自动生成"那一条：开发机上恰好设了环境变量会让它走 env 分支，
  // 于是 token_file 变成 'env'，下面的身份判据永远认不出自己的服务。先清掉。
  delete env.JINGJIE_AGENT_TOKEN;
  delete env.AGENT_API_TOKEN;
  const child = spawn(process.execPath, [path.join(ROOT, 'agent', 'serve.mjs')], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  const output = [];
  child.stdout.on('data', (d) => output.push(String(d)));
  child.stderr.on('data', (d) => output.push(String(d)));
  const tokenFile = path.join(appData, 'agent-api.token');
  let base = null;
  let realPort = 0;
  try {
    // 端口被占时服务按契约 +1（最多 12 格），所以这里也扫同一段；
    // 认出"这一格是我的服务"的判据是 /api/health 里的 guard.token_file ——
    // 它必须等于本用例独占的临时目录，别的进程不可能报出同一个路径。
    for (let i = 0; i < 60 && !base; i++) {
      await sleep(500);
      if (child.exitCode !== null) throw new Error(`服务进程提前退出（${child.exitCode}）：${output.join('').slice(0, 400)}`);
      if (!existsSync(tokenFile)) continue;   // 令牌还没落盘 = start() 还没走完
      for (let p = port; p < port + 12 && !base; p++) {
        try {
          const r = await fetch(`http://127.0.0.1:${p}/api/health`, { signal: AbortSignal.timeout(1500) });
          if (!r.ok) continue;
          const health = await r.json();
          if (health?.data?.guard?.token_file === tokenFile) { base = `http://127.0.0.1:${p}`; realPort = p; }
        } catch { /* 还没起来 */ }
      }
    }
    if (!base) throw new Error(`没找到本用例的服务（端口 ${port}..${port + 11}）：${output.join('').slice(0, 400)}`);
    const token = readFileSync(tokenFile, 'utf8').trim();
    await run({ base, port: realPort, token, dataRoot, appData, tokenFile });
  } finally {
    if (child.pid) {
      try {
        // Windows 上 kill 只杀直接子进程，这里按进程树收；打不到就退回普通 kill
        const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
        killer.on('error', () => { try { child.kill(); } catch { /* 已退 */ } });
      } catch { try { child.kill(); } catch { /* 已退 */ } }
    }
    rmSync(dir, { recursive: true, force: true });
  }
}

const authed = (token, extra = {}) => ({ 'content-type': 'application/json', [TOKEN_HEADER]: token, ...extra });

test('守卫拒绝四种越界形状，而合法的回环+令牌路径照常工作', async () => {
  await withServer(async ({ port, token, dataRoot }) => {
    // 1) 伪造 Host（哪怕令牌是真的、Origin 与 Host 自洽）—— 必须 403
    const forged = await rawRequest({
      port,
      hostHeader: `evil.example.com:${port}`,
      method: 'POST',
      path: '/api/agent/tool',
      headers: { [TOKEN_HEADER]: token, origin: `http://evil.example.com:${port}` },
      body: JSON.stringify({ tool: 'jingjie.env_probe', input: { powerShellProbe: false, providerCheck: false } })
    });
    assert.equal(forged.status, 403, `伪造 Host 应当 403，实得 ${forged.status}：${forged.text.slice(0, 120)}`);
    assert.equal(forged.json?.error?.code, 'HOST_NOT_ALLOWED');

    // 2) 跨源 Origin 的 POST（Host 是真的、令牌是真的）—— 必须 403
    const evil = await fetch(`http://127.0.0.1:${port}/api/agent/tool`, {
      method: 'POST',
      headers: authed(token, { origin: 'https://evil.example.com' }),
      body: JSON.stringify({ tool: 'jingjie.env_probe', input: { powerShellProbe: false, providerCheck: false } })
    });
    assert.equal(evil.status, 403, `跨源 Origin 应当 403，实得 ${evil.status}`);
    const evilBody = await evil.json();
    assert.equal(evilBody.error?.code, 'ORIGIN_NOT_ALLOWED');
    // 拒答也不许带通配 CORS
    assert.equal(evil.headers.get('access-control-allow-origin'), null);

    // 3) 缺令牌的 POST —— 必须 401
    const noToken = await fetch(`http://127.0.0.1:${port}/api/agent/tool`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tool: 'jingjie.env_probe', input: {} })
    });
    assert.equal(noToken.status, 401, `缺令牌应当 401，实得 ${noToken.status}`);
    assert.equal((await noToken.json()).error?.code, 'TOKEN_REQUIRED');

    // 4) 唯一会动系统的那把刀：plan_execute 带 confirm:true 但没有令牌 —— 拒在业务分支之前，
    //    而"没动过任何东西"用产物证明：账本根里不许出现 plan-history.json
    const armedNoToken = await fetch(`http://127.0.0.1:${port}/api/agent/tool`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tool: 'jingjie.plan_execute', input: { confirm: true, sections: ['cleanup'] } })
    });
    assert.equal(armedNoToken.status, 401, `无令牌的 plan_execute 应当 401，实得 ${armedNoToken.status}`);
    assert.equal(existsSync(path.join(dataRoot, 'plan-history.json')), false, '被守卫拒掉的执行不许留下任何账本');

    //    有令牌但没有 confirm —— 只摊开计划，同样不许留下执行记录
    const armedWithTokenNoConfirm = await fetch(`http://127.0.0.1:${port}/api/agent/tool`, {
      method: 'POST',
      headers: authed(token),
      body: JSON.stringify({ tool: 'jingjie.plan_execute', input: { confirm: false, sections: ['cleanup'] } })
    });
    assert.equal(armedWithTokenNoConfirm.status, 200);
    const previewed = await armedWithTokenNoConfirm.json();
    assert.equal(previewed.ok, true);
    assert.equal(previewed.data.executed, false);
    assert.equal(previewed.data.reason, 'needs-confirmation');
    assert.equal(existsSync(path.join(dataRoot, 'plan-history.json')), false, 'confirm:false 只回计划，不许动系统');

    // 5) 合法路径：回环 Host + 令牌 → 读工具真返回本机数据
    //    （body 只读一次：把 await ok.text() 塞进断言消息的模板字符串会提前消耗掉它，
    //      于是下一次 ok.json() 报 "Body is already been read" —— 这条测试自己就会假红）
    const ok = await fetch(`http://127.0.0.1:${port}/api/agent/tool`, {
      method: 'POST',
      headers: authed(token),
      body: JSON.stringify({ tool: 'jingjie.env_probe', input: { powerShellProbe: false, providerCheck: false } })
    });
    const okText = await ok.text();
    assert.equal(ok.status, 200, `合法调用应当 200，实得 ${ok.status}：${okText.slice(0, 200)}`);
    const body = JSON.parse(okText);
    assert.equal(body.ok, true);
    assert.equal(body.data.project.name, 'jingjie');
    assert.equal(typeof body.data.environmentIsSafe, 'boolean');
    // Authorization: Bearer 是等价通道
    const viaBearer = await fetch(`http://127.0.0.1:${port}/api/agent/tool`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ tool: 'jingjie.env_probe', input: { powerShellProbe: false, providerCheck: false } })
    });
    const viaBearerText = await viaBearer.text();
    assert.equal(viaBearer.status, 200, `Bearer 通道应当 200：${viaBearerText.slice(0, 200)}`);
    // 错的令牌仍然要拒
    const wrongToken = await fetch(`http://127.0.0.1:${port}/api/agent/tool`, {
      method: 'POST',
      headers: authed('f'.repeat(64)),
      body: JSON.stringify({ tool: 'jingjie.env_probe', input: {} })
    });
    assert.equal(wrongToken.status, 401);
    assert.equal(wrongToken.headers.get('access-control-allow-origin'), null, '拒答响应也不许带通配 CORS');
  });
});

test('任何端点都不下发通配 CORS，预检也不例外', async () => {
  await withServer(async ({ port, token }) => {
    const responses = [];
    responses.push(await fetch(`http://127.0.0.1:${port}/api/health`));
    responses.push(await fetch(`http://127.0.0.1:${port}/api/agent/tools`));
    responses.push(await fetch(`http://127.0.0.1:${port}/api/agent/tool`, {
      method: 'POST', headers: authed(token),
      body: JSON.stringify({ tool: 'jingjie.env_probe', input: { powerShellProbe: false, providerCheck: false } })
    }));
    responses.push(await fetch(`http://127.0.0.1:${port}/api/nope`));
    for (const res of responses) {
      assert.equal(res.headers.get('access-control-allow-origin'), null, `${res.url} 仍带 ACAO：${res.headers.get('access-control-allow-origin')}`);
      assert.equal(res.headers.get('access-control-allow-credentials'), null);
      assert.equal(res.headers.get('cache-control'), 'no-store');
    }
    // 预检：不带令牌 → 守卫先拒；带令牌也不给跨源放行
    const preflight = await rawRequest({ port, hostHeader: `127.0.0.1:${port}`, method: 'OPTIONS', path: '/api/agent/tool' });
    assert.match(preflight.head, /HTTP\/1\.1 (401|403)/, `OPTIONS 不带令牌却被放行：${preflight.head.split('\r\n')[0]}`);
    assert.doesNotMatch(preflight.head, /access-control-allow/i, `OPTIONS 回了 CORS 放行头：${preflight.head}`);
    const preflightAuthed = await rawRequest({ port, hostHeader: `127.0.0.1:${port}`, method: 'OPTIONS', path: '/api/agent/tool', headers: { [TOKEN_HEADER]: token } });
    assert.doesNotMatch(preflightAuthed.head, /access-control-allow/i, '带令牌的预检也不该拿到跨源放行');
    assert.match(preflightAuthed.head, /HTTP\/1\.1 405/);
  });
});

test('守卫拒掉的请求不会把回执写成成功，也不泄露令牌', async () => {
  await withServer(async ({ port, token, tokenFile }) => {
    const denied = await rawRequest({ port, hostHeader: `evil.example.com:${port}`, path: '/api/health' });
    assert.equal(denied.status, 403);
    assert.equal(denied.json?.ok, false);
    assert.equal(denied.json?.error?.code, 'HOST_NOT_ALLOWED');
    // 回执里说清了"该指到哪个地址"，但没有把令牌写进任何响应
    assert.match(denied.json.error.message, /127\.0\.0\.1/, '拒绝理由要能照着做');
    assert.doesNotMatch(denied.text, new RegExp(token.slice(0, 16)), '回执泄露了令牌前缀');
    const health = await (await fetch(`http://127.0.0.1:${port}/api/health`)).json();
    assert.doesNotMatch(JSON.stringify(health), new RegExp(token), '/api/health 把令牌原样带出去了');
    // 状态端点必须把守卫的形状说出来（端口白名单 / 令牌来源文件 / 不发通配 CORS），
    // 这样"守卫在不在"是一件可查的事，不是只能读源码
    assert.equal(health.data.guard.wildcard_cors, false);
    assert.equal(health.data.guard.token_file, tokenFile);
    assert.match(health.data.guard.host, new RegExp(`127\\.0\\.0\\.1:${port}`));
  });
});
