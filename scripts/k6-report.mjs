import fs from "node:fs/promises";
import path from "node:path";
const directory = path.resolve(process.argv[2] || "");
if (!process.argv[2]) throw new Error("Usage: node scripts/k6-report.mjs <result-directory>");
const read = async (name) => JSON.parse(await fs.readFile(path.join(directory, name), "utf8"));
const report = await read("report.json");
let summary, render, external;
try { summary = await read("k6-summary.json"); } catch { summary = { metrics: {} }; }
try { render = await read("render-metrics.json"); } catch { /* Monitoring may not be collected yet. */ }
try { external = await read("external-observer.json"); } catch { /* A second client is optional. */ }
const metrics = summary.metrics;
const escape = (value) => String(value ?? "—").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const number = (value, unit = "") => Number.isFinite(value) ? Number(value).toFixed(value < 10 ? 2 : 1) + unit : "—";
const milliseconds = (value) => number(value, " ms");
const rate = (name) => metrics[name] ? `${metrics[name].passes}/${metrics[name].passes + metrics[name].fails}（${number(metrics[name].value * 100, "%")}）` : "—";
const metricValues = (name) => (render?.metrics?.find((m) => m.type === name)?.data || []).flatMap((series) => series.values || []).map((v) => v.value).filter(Number.isFinite);
const peak = (name) => { const values = metricValues(name); return values.length ? Math.max(...values) : null; };
const cpuLimit = peak("cpu_limit"), memoryLimit = peak("memory_limit");
const failedThresholds = Object.entries(metrics).flatMap(([name, metric]) => Object.entries(metric.thresholds || {})
  .filter(([, result]) => result === true || result?.ok === false).map(([threshold]) => ({ name, threshold })));
const rows = [
  ["创建玩家成功", rate("player_join_ok")], ["长连接认证成功", rate("socket_login_ok")],
  ["看到开场 / 看到最终结算", `${metrics.game_starts_seen?.count || 0} / ${metrics.game_endings_seen?.count || 0}（目标各${report.players}）`],
  ["全程最低在线人数", report.minOnlineDuringGame], ["非计划断线", metrics.unexpected_disconnects?.count],
  ["正常完成会话", rate("session_ok")],
  ["投骰发送 / 接受", `${metrics.rolls_sent?.count || 0} / ${metrics.rolls_accepted?.count || 0}`],
  ["答题发送 / 接受", `${metrics.answers_sent?.count || 0} / ${metrics.answers_accepted?.count || 0}`],
  ["投骰确认 p95 / 最慢", `${milliseconds(metrics.roll_ack_ms?.["p(95)"])} / ${milliseconds(metrics.roll_ack_ms?.max)}`],
  ["答题确认 p95 / 最慢", `${milliseconds(metrics.answer_ack_ms?.["p(95)"])} / ${milliseconds(metrics.answer_ack_ms?.max)}`],
  ["答案可见 p95 / 最慢", `${milliseconds(metrics.answer_visible_ms?.["p(95)"])} / ${milliseconds(metrics.answer_visible_ms?.max)}`],
  ["主持人操作 p95 / 最慢", `${milliseconds(report.hostAckMs?.p95)} / ${milliseconds(report.hostAckMs?.max)}`],
  ["认证耗时 p95 / 最慢", `${milliseconds(metrics.socket_login_ms?.["p(95)"])} / ${milliseconds(metrics.socket_login_ms?.max)}`],
  ["游戏回合 / 题目 / 加投", `${report.coverage.turns.length} / ${report.coverage.quizzes.length} / ${report.coverage.revotes.length}`],
  ["Render CPU峰值 / 配额", cpuLimit ? `${number(peak("cpu_usage") / cpuLimit * 100, "%")} / ${cpuLimit} CPU` : "待采集"],
  ["Render内存峰值 / 配额", memoryLimit ? `${number(peak("memory_usage") / 1048576, " MiB")} / ${number(memoryLimit / 1073741824, " GiB")}` : "待采集"],
  ["单个大屏帧间隔 p95 / 最长", `${milliseconds(report.browser?.frameGapMs?.p95)} / ${milliseconds(report.browser?.frameGapMs?.max)}`],
  ["大屏页面错误 / 失败请求", `${report.browser?.runtimeErrors?.length ?? "未观察"} / ${report.browser?.failedRequests?.length ?? "未观察"}`],
];
const duration = (new Date(report.gameFinishedAt || report.testEndedAt) - new Date(report.startedAt)) / 1000;
const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${report.players}人完整游戏压测</title>
<style>body{font:16px/1.7 system-ui,sans-serif;color:#302820;background:#f8f6f1;margin:0;padding:24px}main{max-width:980px;margin:auto;background:white;padding:36px;border-radius:16px}h1{line-height:1.3}h2{font-size:21px;margin-top:30px}.status{padding:14px 18px;border-radius:8px;background:${report.passed ? "#eaf5e7" : "#fff0dc"};font-weight:bold}table{border-collapse:collapse;width:100%;margin:20px 0}td,th{text-align:left;border-bottom:1px solid #e8e1d7;padding:10px 8px;vertical-align:top}td:first-child{width:42%}.note{color:#6a6257}img{max-width:100%;border:1px solid #eee;border-radius:10px}a{color:#1859a2}code{overflow-wrap:anywhere}</style>
<main><h1>${report.players}人同局完整游戏压测</h1><p class="status">完整游戏：${report.completion ? "已完成" : "未完成"} · 性能标准：${report.passed ? "通过" : "未通过"}</p>
<p>站点：${escape(report.base)}<br>房间：${escape(report.room)} · 五队均分<br>开始：${escape(new Date(report.startedAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false }))}（北京时间）<br>准备、加入及游戏共约${number(duration / 60, "分钟")}；清理时间另计。</p>
${report.failures.length ? `<h2>未通过原因</h2><ul>${report.failures.map((f) => `<li>${escape(f)}</li>`).join("")}${failedThresholds.map((f) => `<li>${escape(f.name)}：目标 ${escape(f.threshold)}，实测p95为${milliseconds(metrics[f.name]?.["p(95)"])}。</li>`).join("")}</ul>` : ""}
<table><thead><tr><th>项目</th><th>实测结果</th></tr></thead><tbody>${rows.map(([label, value]) => `<tr><td>${escape(label)}</td><td>${escape(value)}</td></tr>`).join("")}</tbody></table>
<h2>验证范围</h2><p>本轮为${report.players}个真实协议虚拟玩家，持续进行身份认证、心跳、投骰、答题和状态同步；按正常队伍顺序，首队冲线后由主持人结束，检查五队颁奖和抽奖资格。第一题刻意平票以覆盖加投。</p><p class="note">浏览器观察来自压测电脑上的一个大屏，不代表${report.players}部真实手机的动画帧率。未覆盖现场Wi-Fi或${report.players}部手机同时加载全部图片/BGM；Render指标按30秒采样，不能排除更短的瞬时峰值。200人结果不能直接推算1500人容量。</p>
${external ? `<h2>本机访问路径的旁观结果</h2><p>另用这台电脑打开真实大屏，观察到五队结算，页面错误${external.errors.length}个。</p><ul><li>健康请求中位数${milliseconds(external.healthMs?.median)}，p95 ${milliseconds(external.healthMs?.p95)}，最长${milliseconds(external.healthMs?.max)}。</li><li>状态到达耗时估算p95 ${milliseconds(external.snapshotDelayMs?.p95)}，校准不确定度约±${milliseconds(external.clockUncertaintyMs)}。</li><li>画面帧间隔p95 ${milliseconds(external.frameGapMs?.p95)}。帧率平稳不代表网络状态没有延迟。</li><li>记录到${external.disconnects}次WebSocket关闭；这是单个旁观连接的传输记录，不是200名玩家掉线数。</li></ul><p class="status">本机访问曾出现明显等待，现场网络流畅性尚未通过验收。云端200人结果与本机访问结果应分开看。</p>` : ""}
<h2>测试清理</h2><p>${report.cleanup?.error ? escape(report.cleanup.error) : `已移除本轮${report.cleanup?.removed ?? 0}个机器人。数据库保留已移除的测试记录。`}</p>
<h2>原始证据</h2><p><a href="report.json">完整流程结果</a> · <a href="k6-summary.json">k6指标</a> · <a href="k6.log">k6日志</a> · <a href="timeline.jsonl">流程时间线</a> · <a href="render-metrics.json">Render监控</a></p>
${report.completion && report.browser ? '<h2>最终五队颁奖</h2><img src="awards.png" alt="本轮最终五队颁奖截图">' : ""}</main></html>`;
await fs.writeFile(path.join(directory, "report.html"), html);
console.log(path.join(directory, "report.html"));
