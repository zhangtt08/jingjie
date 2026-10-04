#!/usr/bin/env node
// agent/serve.mjs —— 端口固定启动器。
// server.mjs 的兜底端口是 8790，而净界在统一注册表里占的是 8796（见 docs/AGENT_API_STANDARD.md 的端口表），
// 所以这里把端口固定成 8796 再调 start()。等价写法：AGENT_PORT=8796 node agent/server.mjs
// 环境变量优先级与 agent/README.md 的表一致：JINGJIE_AGENT_PORT > AGENT_PORT > PORT > 8796。
// （以前只认 JINGJIE_AGENT_PORT：自检脚本按 README 传 AGENT_PORT 会静默起在 8796，
//   测试之间、以及与真服务之间互相抢端口 —— 现在按 README 说的做。）
import { start } from './server.mjs';

const PORT = Number(process.env.JINGJIE_AGENT_PORT || process.env.AGENT_PORT || process.env.PORT || 0) || 8796;

start({ port: PORT, label: 'jingjie' }).catch((error) => {
  console.error('[agent] failed to start:', error.message);
  process.exit(1);
});
