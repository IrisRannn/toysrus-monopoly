# 现场与正式部署

本系统沿用 React/Vite + Express + Socket.IO。所有设备连接同一个可信 Node 后端；游戏数据保存在数据库，浏览器只保留身份凭证。没有使用 localStorage 模拟游戏同步。

## 本地或局域网

需要 Node.js 20.20.2+（已在20.20.2验证）。

```bash
npm ci --include=dev --registry=https://registry.npmjs.org --replace-registry-host=registry.npmmirror.com
cp .env.example .env
npm run dev
```

主持人打开端口5180的 `/host`。开发默认口令为 `local-host-change-me`，可以通过 `.env` 的 `HOST_PASSWORD` 修改。创建房间后进入控制台，点击“打开游戏大屏”。玩家访问同一站点的 `/player?room=房间号`。兼容旧玩家路径 `/m`。

手机与电脑须在可相互访问的网络。二维码中的“手机可访问的站点地址”必须使用电脑的局域网IP或正式域名。手机扫描localhost无法连接电脑。前端端口5180反向代理到后端3001，因此开发模式后端端口保持3001。仅运行 `vite preview` 无法提供游戏后端。

## 单实例生产服务（SQLite）

```bash
npm run build
# 通过部署平台安全环境变量设置，勿提交到仓库。
export HOST_PASSWORD='替换为至少12位的强口令'
export PUBLIC_BASE_URL='https://game.example.com'
npm start
```

生产服务端口默认3001，也可通过 `PORT` 设置。单个 Node 进程同时提供静态前端、API和Socket.IO。反向代理必须支持 WebSocket Upgrade、保持同源、允许足够长的连接空闲时间。使用HTTPS域名以便现场手机浏览器接入。

SQLite数据库默认 `data/game.sqlite`，原图上传保存在 `data/assets/`，同时原样复制到 `public/assets/`。持久化挂载整个 `data/` 目录；定期备份，避免将每次重启部署成空目录。SQLite适配器将事务后的数据库导出到临时文件、fsync再原子替换，支持进程重启恢复；只允许一个应用实例写此文件。不要让多个容器或进程共享同一个SQLite文件。

`render.yaml` 提供带持久化磁盘的付费单实例配置。免费无持久化磁盘实例不适合承载现场游戏。

## PostgreSQL / Supabase

1. 在Supabase SQL Editor或 `psql` 中执行 `supabase/migrations/202611020001_game.sql`。无正式题目种子，`supabase/seed.sql`仅说明用途。
2. 在服务器安全环境变量中配置 `DATABASE_URL`，使用Supabase的PostgreSQL直连或session pooler连接串，IPv4环境通常选session pooler。使用数据库所有者或具备服务端权限的数据库账号，不能使用匿名浏览器凭证。
3. TLS保持校验开启。连接串使用 `sslmode=verify-full`，如果数据库证书需要额外CA，通过受信任CA路径配置，不要使用 `rejectUnauthorized:false`。
4. 同时设置 `HOST_PASSWORD` 和 `PUBLIC_BASE_URL`。`.env.example` 有完整模板。`DATABASE_URL`、数据库密码和任何Supabase service role密钥绝不能设置为 `VITE_` 变量，也不能发送到浏览器。
5. 重启Node服务，`/api/health` 的 `database` 应为 `postgresql`，再实际创建测试房间并跨设备验证。没有配置真实Supabase项目时不能声称已经连接该项目。

实现通过服务器的 `BEGIN`、房间级 `pg_advisory_xact_lock` 和 `SELECT FOR UPDATE`，将房间状态、队伍、员工、题目、答案、回合与前后状态审计记录在同一事务提交。答题按“题次+员工”唯一键更新。单个 Node 实例通过Socket.IO向三端发布按角色过滤的状态，不依赖浏览器直连数据库或Supabase Realtime。不要直接给浏览器开放 `game_rooms.state`，它包含私有题目和凭证散列。

迁移开启所有游戏表的RLS，撤销PUBLIC、anon、authenticated的访问，不提供匿名查询策略。后台通过服务器数据库连接操作。当前实时发布服务要求**一个应用实例**；数据库锁保证可靠写入，但多实例间的Socket.IO广播仍需额外的共享适配器，当前未实现。

在线状态来自实际Socket连接，不把重启前的连接当作在线。移动、答题截止时间保存在数据库；重启后按状态机继续处理，暂停的房间仍保持暂停。重启前未完成的动画可能在恢复时直接展示已保存的位置，棋子最终位置以数据库为准。

## Docker

```bash
docker build -t monopoly .
docker run --rm -p 3001:3001 --env-file .env \
  -v monopoly-data:/app/data monopoly
```

托管云环境的TLS代理构建需传入公开CA，例如：

```bash
docker build --secret id=proxy_ca,src="$CODEX_PROXY_CERT" -t monopoly .
```

保留平台代理和CA，不能禁用TLS或npm完整性校验。

## 原图、题目与现场演练

本次会话的红色20格棋盘图片尚未作为可下载文件提供；旧橙色28格背景 `public/board.png` 已删除；`board-game-deploy.zip` 是未用于运行的旧归档。请将原始红色JPG/PNG放入 `public/assets/游戏背景图.jpg`（PNG用 `.png`），或在主持人端“棋盘校准”上传。上传只校验文件类型和大小，不修改原始字节。

初始20个坐标来自任务参考表，保存在 `shared/tilePositions.js`。上传原图后拖动编号校准，保存到房间并同步三端；支持JSON导入导出。正式展示使用同一个16:9图片容器定位棋子，不用viewport坐标。

正式题库默认空白。请用CSV/XLSX模板导入经品牌方确认的题目。题次内每名员工可修改一份答案，最高单项票胜出、最高票并列或无人提交均未答对。默认30秒，主持人可设置5–300秒。答对只移动，不产生积分。

上线前请用真实员工手机、现场Wi-Fi、投屏设备和正式域名演练一次；公开互联网部署前设置强主持人口令。员工身份是免注册设备会话，不是实名企业账号；清除站点存储后无法识别为同一自然人。如需强实名去重，应另接企业身份系统。

## 依赖审计记录

交付时已将旧Vite升级到7系列，并更新兼容补丁，修复本次实际审计发现的3项高危问题（Vite、body-parser、source-map-js）。`npm audit`仍报告19项中危依赖链告警，根因集中在ESLint/ExcelJS的间接依赖minimatch与uuid。没有使用强制降级或不兼容的全局override来隐藏告警。Excel导入仅对已认证主持人开放，文件限制为5MB；不要导入来源不明的工作簿。正式部署方应持续跟踪上游修复。本项目不声称依赖审计为零漏洞。
