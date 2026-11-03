# 现场与正式部署

本系统沿用 React/Vite + Express + Socket.IO。所有设备连接同一个可信 Node 后端；游戏数据保存在数据库，浏览器只保留身份凭证。没有使用 localStorage 模拟游戏同步。

## 本地或局域网

需要 Node.js 20.20.2+（已在20.20.2验证）。

```bash
npm ci --include=dev --registry=https://registry.npmjs.org --replace-registry-host=registry.npmmirror.com
cp .env.example .env
npm run dev
```

主持人打开端口5180的 `/host`。按用户要求无需主持人口令，可直接创建房间或输入房间号进入。创建房间后进入控制台，点击“打开游戏大屏”。玩家访问同一站点的 `/player?room=房间号`。兼容旧玩家路径 `/m`。

手机与电脑须在可相互访问的网络。二维码中的“手机可访问的站点地址”必须使用电脑的局域网IP或正式域名。手机扫描localhost无法连接电脑。前端端口5180反向代理到后端3001，因此开发模式后端端口保持3001。仅运行 `vite preview` 无法提供游戏后端。

## 单实例生产服务（SQLite）

现有 Render 免费服务可直接运行，无需设置主持人口令。免费实例的文件系统是临时存储：SQLite能保留当前实例内的页面刷新和重连状态，但实例更换或重新部署可能清空进度。当前按用户选择保留免费方案，不主动开通付费资源。下述持久化磁盘和PostgreSQL方案用于需要长期保留数据时。

```bash
npm run build
export PUBLIC_BASE_URL='https://game.example.com'
npm start
```

生产服务端口默认3001，也可通过 `PORT` 设置。单个 Node 进程同时提供静态前端、API和Socket.IO。反向代理必须支持 WebSocket Upgrade、保持同源、允许足够长的连接空闲时间。使用HTTPS域名以便现场手机浏览器接入。

SQLite数据库默认 `data/game.sqlite`，原图上传保存在 `data/assets/`，同时原样复制到 `public/assets/`。持久化挂载整个 `data/` 目录；定期备份，避免将每次重启部署成空目录。SQLite适配器将事务后的数据库导出到临时文件、fsync再原子替换，支持进程重启恢复；只允许一个应用实例写此文件。不要让多个容器或进程共享同一个SQLite文件。

`render.yaml` 保留仓库既有服务定义。可选的 `deploy/render-persistent.yaml` 提供带持久化磁盘的付费单实例配置，只在明确选择该部署方案后使用；代码更新不会主动调整现有套餐。免费无持久化磁盘实例如需承载现场游戏，应配置持久化的 PostgreSQL `DATABASE_URL`。

## PostgreSQL / Supabase

1. 在Supabase SQL Editor或 `psql` 中执行 `supabase/migrations/202611020001_game.sql`。内置19题由应用为每个新房间自动加载，不需要另执行题目SQL；`supabase/seed.sql`仅说明用途。
2. 在服务器安全环境变量中配置 `DATABASE_URL`，使用Supabase的PostgreSQL直连或session pooler连接串，IPv4环境通常选session pooler。使用数据库所有者或具备服务端权限的数据库账号，不能使用匿名浏览器凭证。
3. TLS保持校验开启。连接串使用 `sslmode=verify-full`，如果数据库证书需要额外CA，通过受信任CA路径配置，不要使用 `rejectUnauthorized:false`。
4. 可设置 `PUBLIC_BASE_URL`（未设置时二维码使用当前浏览器站点地址），不再需要 `HOST_PASSWORD`。`.env.example` 有完整模板。`DATABASE_URL`、数据库密码和任何Supabase service role密钥绝不能设置为 `VITE_` 变量，也不能发送到浏览器。
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

红色20格棋盘已从用户上传到GitHub的 `public/board-20.jpg` 接入，原样副本在 `public/assets/游戏背景图.jpg`；旧橙色28格背景 `public/board.png` 已删除；`board-game-deploy.zip` 是未用于运行的旧归档。后续更换背景时，可将原始JPG/PNG放入 `public/assets/游戏背景图.jpg`（PNG用 `.png`），或在主持人端“棋盘校准”上传。上传只校验文件类型和大小，不修改原始字节。

初始20个坐标来自任务参考表，保存在 `shared/tilePositions.js`。上传原图后拖动编号校准，保存到房间并同步三端；支持JSON导入导出。正式展示使用同一个16:9图片容器定位棋子，不用viewport坐标。

已内置用户上传的周年题库：20行去掉一条完全重复题目后为19题，五个答题格共用。房间创建时自动加载；旧房间在升级启动时一次性补充，保留进度、原题与已用记录，后续删除或编辑内置题目不会在每次重启时被覆盖。`server/data/anniversary-questions.json`只由服务器读取，不放进公开静态资源。

整场比赛的已用题目按内容与ID共同保护，跨轮次、队伍和格子不重复；CSV/XLSX重复导入相同问题会跳过。共用题池用`tile=0`，专属题用4/8/12/15/16。题目用完须补充新题，系统不会重复旧题或自行编题。只有明确重置整场游戏才清除已用记录。19题不保证覆盖所有走法，应提前准备备用题。

固定内置题库无需外部数据库即可在免费Render重新部署后重新加载；后台新增/编辑的题目、房间和已用记录若要跨免费实例丢盘长期保留，仍须配置外部PostgreSQL。不要把重新创建的房间视为重启前同一场比赛。

题次内每名员工可修改一份答案，最高单项票胜出、最高票并列或无人提交均未答对。默认30秒，主持人可设置5–300秒。答对只移动，不产生积分。

普通线上回合默认自动切队：棋子及奖励/惩罚移动完成后停留1.8秒，服务器持久定时器切到下一支未冲线队伍，等待新代表投骰。答题回合与上海SSC回合不自动切队，保留主持人“下一队”操作。现有房间首次升级会开启此模式，之后保留主持人开关选择；“现场设置”可随时关闭。暂停冻结自动切队计时，恢复后继续；关闭或撤销取消待执行切队。自动切队由服务器执行，不依赖主持人页面一直打开。

特殊格大屏卡片停留2.5秒，之后再执行奖励/惩罚移动或进入待答题。服务器将`tile_event`阶段及展示起止时间存入房间快照，刷新不会重新开始计时，暂停会冻结剩余时间。答对奖励在揭晓阶段展示2.5秒，不能提前跳过特效；移动时让大屏棋盘可见，移动结束后继续保留答案结果。二次落点不连锁触发事件。无需新增数据库迁移；免费实例丢盘时仍无法恢复旧房间。

上线前请用真实员工手机、现场Wi-Fi、投屏设备和正式域名演练一次；主持人入口为用户明确要求的免口令模式。员工身份是免注册设备会话，不是实名企业账号；清除站点存储后无法识别为同一自然人。如需强实名去重，应另接企业身份系统。

## 依赖审计记录

交付时已将旧Vite升级到7系列，并更新兼容补丁，修复本次实际审计发现的3项高危问题（Vite、body-parser、source-map-js）。`npm audit`仍报告19项中危依赖链告警，根因集中在ESLint/ExcelJS的间接依赖minimatch与uuid。没有使用强制降级或不兼容的全局override来隐藏告警。Excel导入仅对已认证主持人开放，文件限制为5MB；不要导入来源不明的工作簿。正式部署方应持续跟踪上游修复。本项目不声称依赖审计为零漏洞。
