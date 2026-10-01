#!/usr/bin/env node
// agent/serve.mjs —— 端口固定启动器。
// server.mjs 是 personal-agent-hub 的标准实现，逐字复制、不许改动，而它的默认端口是 8790；
// 净界在统一注册表里占的是 8796（见 docs/AGENT_API_STANDARD.md 的端口表）。
// 所以这里只做一件事：用 8796 调 start()。等价写法：AGENT_PORT=8796 node agent/server.mjs
import { start } from './server.mjs';

const PORT = Number(process.env.JINGJIE_AGENT_PORT || 8796);

start({ port: PORT, label: 'jingjie' }).catch((error) => {
  console.error('[agent] failed to start:', error.message);
  process.exit(1);
});
