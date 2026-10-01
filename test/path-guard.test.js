import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluatePath, isVolumeRoot, protectedRoots, environmentIsSafe } from '../src/main/path-guard.js';

// 这棵树会删文件，path-guard 是它的命。断言只钉在源码里读得到的分支上：
// env 的键是 userProfile/localAppData/tempRoot/windowsRoot（不是 PROCESS ENV 名），
// 且 rule.id 必须落在 expectedRuleRoot 的白名单里，否则先被 unsafe-rule-root 拦掉。

const env = {
  userProfile: 'C:\\Users\\tester',
  localAppData: 'C:\\Users\\tester\\AppData\\Local',
  tempRoot: 'C:\\Users\\tester\\AppData\\Local\\Temp',
  windowsRoot: 'C:\\Windows',
};
const rule = { id: 'user-temp', root: env.tempRoot };

test('环境不完整时判为不安全，而不是抛异常', () => {
  assert.equal(environmentIsSafe(env), true);
  for (const key of ['userProfile', 'localAppData', 'tempRoot', 'windowsRoot']) {
    const broken = { ...env, [key]: undefined };
    assert.equal(environmentIsSafe(broken), false, `缺 ${key} 应判不安全`);
    // 回归：这里以前会走到 win32.isAbsolute(undefined) 直接 TypeError。
    assert.equal(evaluatePath(`${env.tempRoot}\\a.txt`, rule, broken).allowed, false);
  }
});

test('空值、NUL、相对路径一律拒绝', () => {
  // '\u0000' 才是 NUL 字节；写 'C:\\x\\0y' 只是反斜杠加字母零，护栏按绝对路径放行是对的。
  for (const bad of [undefined, null, '', `C:\\x\\${'\u0000'}y`, 'relative\\path.txt', '.\\down']) {
    const decision = evaluatePath(bad, rule, env);
    assert.equal(decision.allowed, false, `应当拒绝：${JSON.stringify(bad)}`);
    assert.equal(decision.reason, 'invalid-path');
  }
});

test('不允许拿规则根目录本身当清理目标', () => {
  assert.equal(evaluatePath(rule.root, rule, env).reason, 'rule-root');
  assert.equal(evaluatePath(`${rule.root}\\`, rule, env).reason, 'rule-root');
});

test('根目录之外与根目录不匹配都被拒绝', () => {
  assert.equal(evaluatePath('C:\\Users\\tester\\Documents\\x.txt', rule, env).reason, 'outside-rule-root');
  assert.equal(evaluatePath(`${env.tempRoot}\\keep\\a`, rule, env).allowed, true);
  // 根指向别处（哪怕在 Temp 下）就不是这条规则该动的地方
  assert.equal(evaluatePath(`${env.tempRoot}\\keep\\a`, { id: 'user-temp', root: env.userProfile }, env).reason, 'unsafe-rule-root');
});

test('符号链接直接拒绝（不跟着链接删到别处）', () => {
  const inside = `${rule.root}\\sub\\file.txt`;
  assert.equal(evaluatePath(inside, rule, env).allowed, true);
  assert.equal(evaluatePath(inside, rule, env, { isSymbolicLink: true }).reason, 'symbolic-link');
});

test('未登记的规则 id 一律拒绝（不给自由指定清理范围）', () => {
  assert.equal(evaluatePath(`${env.tempRoot}\\a`, { id: 'my-whole-disk', root: env.tempRoot }, env).reason, 'unsafe-rule-root');
});

test('受保护根清单非空且包含系统根', () => {
  const roots = protectedRoots(env);
  assert.ok(Array.isArray(roots) && roots.length > 0);
  const lowered = roots.map((r) => String(r).toLowerCase());
  assert.ok(lowered.some((r) => r.startsWith('c:\\windows')), `保护清单应覆盖系统目录：${lowered.join(', ')}`);
});

test('卷根判断', () => {
  assert.equal(isVolumeRoot('C:\\'), true);
  assert.equal(isVolumeRoot('C:'), true);
  assert.equal(isVolumeRoot('C:\\Users'), false);
});
