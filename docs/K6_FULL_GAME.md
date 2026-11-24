# 200人完整游戏自动压测

`scripts/k6-full-game.mjs`负责自动主持和收集报告，`scripts/k6-players.js`负责真实k6虚拟玩家。无需重新部署游戏。

## 运行条件

- Node.js、项目依赖及当前版k6已安装。
- 目标房间不存在，或处于等待开场且没有有效员工、没有在线玩家。脚本拒绝重置已有游戏。
- 使用261218正式房间时必须显式设置`ALLOW_FORMAL_ROOM=true`。正式规则包含首队冲线庆祝、停止继续和主持人最终结算。
- 测试会创建机器人、运行真实游戏并消耗服务器资源；同一服务上的其他房间共用资源。

## 本机运行200人

在项目目录运行：

```sh
BASE_URL=https://toysrus-monopoly.onrender.com \
ROOM_CODE=261218 ALLOW_FORMAL_ROOM=true PLAYERS=200 \
K6_BIN=/Users/yangyiran/Tools/k6-v2.4.0/k6 \
PLAYWRIGHT_MODULE=/Users/yangyiran/Tools/tru20-browser-check/node_modules/playwright/index.mjs \
BROWSER_EXECUTABLE='/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge' \
node scripts/k6-full-game.mjs
```

其他电脑可设置自己的`K6_BIN`，或让`k6`在PATH中。浏览器观察是可选的；未设置`PLAYWRIGHT_MODULE`时仍会运行协议压测，但不生成大屏截图和帧间隔记录。脚本不安装浏览器依赖、不修改Render套餐，也不部署代码。

`.github/workflows/load-test-200.yml`提供同一流程的GitHub云端运行方式。仅推送指定测试分支或手动触发时运行，不部署游戏。云端与本机发起的结果必须分别记录：云端通过不能证明中国员工访问链路已通过。

## 自动流程

1. 检查房间为空，建立主持人会话。保持东区→中南区→北区→西区→上海SSC的顺序。
2. 默认30秒逐步加入200名独立玩家，每队40人；完成真实Socket.IO认证并持续回复心跳。
3. 等本轮200人全部在线，为前四区选择机器人代表，再开始游戏。到齐超时会失败，不会把不足200人算作通过。
4. 被指定的机器人投骰，上海SSC由自动主持人模拟录入实体骰子。SSC第一轮录入4点以覆盖答题格，后续随机录入1–6点。没有跳格、修改棋子位置或更改骰子概率。
5. 任意队伍进入答题格后，主持人开启真实题库题目，默认30秒；只有当前队伍提交，其余玩家接收实时状态。
6. 默认第一题的40名玩家在A、B各投20票；加投仍各半，覆盖“平票加投一次，仍平按对”的正式规则。其他题目随机选择答案。
7. 首队冲线后，观察冠军庆祝，再由主持人结束游戏。若前3名存在并列，自动主持人通过现有确认功能，将排名≤3的所有队伍纳入二等奖候选；不排除并列队伍。确认五队排名和三个奖项后，每个机器人收到最终结算并正常退出。
8. 保存结果，移除本轮机器人。如果房间没有其他有效员工，恢复等待开场。不会移除其他员工。

`MAX_SECONDS`默认1200，是整轮上限；游戏完成会提前退出，不必等满20分钟。`ANSWER_SECONDS`可设5–300秒，常规测试保留30秒。`FIRST_QUIZ_TIE=false`可关闭刻意平票场景。`CLEANUP=false`可保留机器人供人工检查。

机器人移除采用现有主持人功能，数据库仍保留标记为已移除的记录；反复大量测试会积累数据，需与房间5000条玩家记录上限一起考虑。脚本只清理自己的`k6_本轮编号_`记录。

## 结果文件

默认保存在`artifacts/load-tests/时间-人数/`，也可通过`OUTPUT_DIR`指定。

| 文件 | 内容 |
|---|---|
| `report.json` | 整轮是否完成、是否通过、最低在线人数、各队回合、题目、加投、冠军、排名和清理结果 |
| `k6-summary.json` | 加入/认证成功率、非计划掉线、投骰/答题确认延迟、答案出现在玩家状态中的延迟、全员开场与结算覆盖 |
| `k6.log` | 完整k6输出，包含具体失败原因 |
| `host-metrics.json` | 主持人操作耗时及压测电脑上k6进程的CPU和内存采样，不是Render的CPU指标 |
| `timeline.jsonl` | 带UTC时间的关键步骤，便于与Render监控对照 |
| `browser.json` | 单个真实大屏浏览器的帧间隔、长任务、页面报错和网络失败 |
| `quiz.png`、`victory.png`、`awards.png` | 答题、冠军和最终五队颁奖画面，有浏览器观察时生成 |

建议初筛标准：200人全部看到开场与结算、全程保持在线，非计划掉线为0；投骰/答题95%的确认小于1秒，95%的答案可见延迟小于1.5秒，连接认证95%小于3秒。脚本也检查五队结算数据和加投覆盖。完整游戏完成与性能指标通过分别记录；任一关键条件不满足，`passed`为false。

`snapshot_delivery_estimate_ms`根据预检请求校准服务器与电脑时差，只是广播到达耗时的估算，受预检往返延迟及网络不对称影响。主要以不依赖时钟同步的操作确认和答案可见耗时判断。

## 能证明的范围

这是200名真实协议玩家持续参与同一局的测试，不是200台真实手机。浏览器观察只代表压测电脑上的一个大屏：不能据此保证每种手机的动画帧率，也不覆盖200部手机同时下载全部图片/BGM、现场Wi-Fi或移动网络的表现。

测试结束需按`startedAt`至`testEndedAt`向Render查询CPU、内存和日志，区别服务器负载、网络延迟与压测电脑瓶颈。200人通过后仍需更高人数和更长时段的独立验收。

协议/API参考：[k6 WebSockets](https://grafana.com/docs/k6/latest/javascript-api/k6-websockets/)、[k6阈值](https://grafana.com/docs/k6/latest/using-k6/thresholds/)、[Socket.IO协议](https://socket.io/docs/v4/socket-io-protocol/)。
