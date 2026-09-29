# 玩具反斗城 20周年全员大富翁（年会互动游戏）

三端实时同步：**大屏投屏端** + **主持人控制端** + **员工手机投票端**。
技术栈：React + Vite + TypeScript + Express + Socket.IO。

## 1. 目录说明

```
board-game/
├── public/board.png          # 你提供的棋盘设计图（底图）
├── server/index.js           # Node + Socket.IO 游戏服务端（单一状态源）
├── src/
│   ├── App.tsx                # 按 URL 路由到三端
│   ├── pages/
│   │   ├── BigScreen.tsx      # 大屏端（/）
│   │   ├── Host.tsx           # 主持人端（/host）
│   │   └── Mobile.tsx         # 员工手机端（/m）
│   ├── components/           # Board / Piece / Dice
│   ├── types/                 # TypeScript 类型
│   └── utils/socket.ts       # socket.io-client 连接
└── package.json
```

## 2. 本地运行

```bash
cd board-game
npm install
npm run dev
```

启动后：

| 端 | 地址 | 用途 |
|---|---|---|
| 大屏端 | http://localhost:5173/ | 年会现场投屏（16:9） |
| 主持人端 | http://localhost:5173/host | 主持人笔记本电脑 |
| 员工手机端 | http://**<电脑局域网IP>**:5173/m | 员工扫码/输入网址 |

> 手机要和电脑连同一个 Wi-Fi。把 `localhost` 换成电脑的局域网 IP（例如 `192.168.x.x`）。
> 查看 IP：macOS 上 `ipconfig getifaddr en0`。

## 3. 环境变量

复制 `.env.example` 为 `.env`（可选）：

```
PORT=3001                 # 游戏服务端端口
VITE_SOCKET_URL=          # 前端连接的服务端地址；留空则自动连当前 host
```

部署到服务器时，把 `VITE_SOCKET_URL` 改成 `https://你的域名`，然后：

```bash
npm run build
npm start
```

## 4. 游戏流程（主持人）

1. 大屏打开 `/`，主持人电脑打开 `/host`。
2. 点 **【开始游戏】**。
3. 每队一轮：**投骰子 → 移动棋子 → 判断落点**。
   - 普通格：直接【下一队】。
   - 答题格：【开始答题】→ 员工手机投票 15 秒 →【结束投票】（或倒计时自动）→【公布答案】→ 答对【答对+3】/ 答错自动下一队。
   - 超级挑战格：同上，答对 +5。
   - 幸运格：点【触发幸运效果】自动执行。
4. 3 轮 × 4 队 = 12 回合后，自动出最终排名与抽奖名额（25/15/15/15）。

应急按钮：手动 ±1/±3 修正棋子、手动指定答案、重置游戏。

## 5. 自定义

- **队伍名**：改 `server/index.js` 里的 `TEAM_NAMES`。
- **题库**：改 `server/index.js` 里的 `QUESTIONS` 数组（id / type=normal|challenge / question / options / answer / reward）。
- **棋盘坐标**：改 `server/index.js` 里的 `BOARD` 数组（x/y 为相对于棋盘图的百分比）。
- **工龄代表**：主持人端直接输入姓名和工龄即可。

## 6. 已实现的第一阶段 MVP

- [x] 棋盘图片作为底图 + 棋子覆盖层
- [x] 28 格统一数据（坐标 / 类型 / 特殊效果）
- [x] 4 队棋子、弹跳移动动画
- [x] 骰子滚动动画
- [x] 3 轮 × 4 队流程
- [x] 答题格 / 超级挑战格 / 幸运格
- [x] 手机端选队、单次投票、实时柱状图
- [x] 平票视为失败 + 手动指定答案
- [x] 答对 +3 / 挑战 +5
- [x] 最终排名 + 抽奖名额公布
- [x] 手动修正棋子、重置
