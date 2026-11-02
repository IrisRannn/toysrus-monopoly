# Toys“R”Us 20周年全员互动大富翁

真实多人在线的20格游戏。沿用 React + Vite + TypeScript + Express + Socket.IO；默认使用持久化SQLite，可切换 PostgreSQL/Supabase。游戏状态由可信后端统一维护，刷新、断线重连与服务重启均从数据库恢复。

- `/host`：房间二维码、队伍/员工管理、代表指定、上海SSC实体骰子、题库、答题控制、日志与安全撤销、抽奖资格、棋盘校准。
- `/player`：房间号/扫码加入、固定队伍与昵称、代表投骰、全队答题、截止前改答、实时状态。
- `/screen`：16:9原图棋盘、独立具名棋子、骰子/移动/事件动画、答题与最终排名。
- `/`：三端入口。旧玩家路由 `/m` 兼容。

## 运行

```bash
npm ci --include=dev --registry=https://registry.npmjs.org --replace-registry-host=registry.npmmirror.com
cp .env.example .env
npm run dev
```

Node.js 20.20.2已验证。前端5180，后端3001。按用户要求，主持人无需登录口令，直接创建或进入房间。创建房间后在控制台打开大屏；扫码地址使用局域网IP或HTTPS域名。

## 本次规则

默认顺序：东区（蓝）→ 中南区（绿）→ 北区（金黄）→ 西区（紫）→ 上海SSC（青蓝），开场前可改。0表示棋盘外起点；20格、无限轮次，无积分。四队代表的骰子由后端均匀生成1–6；上海SSC由主持人点击六个点数按钮录入。奖励/惩罚二次移动不触发连锁。先到终点先排名，已完成队伍跳过；允许提前结束，未完成同格并列。

答题格：04/08/12/16答对+3；15答对直达20。最高单项票为集体选择，不要求过半；最高票并列和无人提交未答对。每人每题只保留一份有效答案，截止前可改。未公布前玩家/大屏无法读取正确答案、个人答题记录或实时选项票数；主持人可查看完整数据。

抽奖资格：一等奖500元×1，第1名队伍；二等奖300元×2，前3名队伍；三等奖120元×5，全体员工。并列影响资格时由主持人确认并留日志。提供候选名单导出，不自动抽奖。

## 素材与正式题库

两份Word参考文档已保存在 `public/assets/`。按用户明确要求采用20格文档，不混入旧三轮制。

**红色20格原图已接入。** GitHub上传原件保留在 `public/board-20.jpg`，项目使用的 `public/assets/游戏背景图.jpg` 与原件逐字节一致（1920×1080），未裁切或重绘。旧的橙色28格背景已删除。坐标位于 `shared/tilePositions.js`，已对照原图核对，仍支持拖动、精确数字及JSON导入导出。

正式题库为空，没有伪造品牌知识题。题库管理可增删改、按格选题、随机不重复抽题、CSV/Excel批量导入与下载模板。`public/assets/questions-template.csv` 可直接使用，Excel模板由主持人后台生成。

## 验证

```bash
npm run typecheck
npm run lint
npm test
npm run build
# 已启动开发服务并已安装Python Playwright + Chromium时：
python tests/browser.py
# 已迁移的专用测试PostgreSQL，可额外执行真实行锁测试：
TEST_DATABASE_URL='postgresql://…' npm test
```

测试覆盖全部20格效果、三端权限、10人投票、改答/错答/并列/空票、终极挑战、冲线与排名、10次并发投骰、持久化/重连、撤销、真实CSV/XLSX与候选名单安全导出。PostgreSQL测试在未配置专用测试连接时明确跳过；浏览器脚本创建独立测试房间，不使用正式品牌题库。

生产构建与启动：`npm run build`、`npm start`。完整数据库/RLS、TLS、持久化磁盘、单实例部署、Docker及现场演练说明见 [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)。Supabase项目未配置时不声称已连接；只需服务器端 `DATABASE_URL`，浏览器不需要Supabase密钥。

## 模块

```
shared/gameRules.js           20格规则、队伍、投票与排名
shared/tilePositions.js       棋盘百分比坐标
server/lib/engine.js          可信状态机、权限、撤销、过滤视图
server/lib/store.js           SQLite / PostgreSQL事务与审计
server/lib/import.js          CSV / XLSX导入与安全导出
server/index.js              房间API、身份校验、Socket.IO、持久定时流程
src/pages/                   主持人、玩家、大屏
src/components/Board.tsx     16:9原图、具名棋子、校准模式
supabase/migrations/          PostgreSQL表、索引和RLS
```

浏览器localStorage只存房间身份凭证，不存权威游戏进度。主持人重新进入房间会刷新主持人会话。SQLite需要单进程持久化卷，PostgreSQL写入使用房间锁；实时广播目前也要求单应用实例。部署使用HTTPS；主持人入口按用户要求免口令，能进入该入口的人可管理房间。

当前 Render 免费版使用临时 SQLite：刷新页面、断线重连可恢复同一服务实例中的游戏状态，但重启、休眠后更换实例或重新部署可能清空数据。长期保存可另接 PostgreSQL，不会自动开通付费磁盘。
