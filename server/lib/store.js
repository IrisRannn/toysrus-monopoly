import fs from "node:fs";
import path from "node:path";
import initSqlJs from "sql.js";
import pg from "pg";
import { GameError } from "./engine.js";
const encoded = (x) => JSON.stringify(x);
const decoded = (x) => (typeof x === "string" ? JSON.parse(x) : x);
const projections = [
  "teams",
  "players",
  "questions",
  "answers",
  "game_events",
  "game_turns",
];
export const sqliteSchema = `
CREATE TABLE IF NOT EXISTS game_rooms (code TEXT PRIMARY KEY, version INTEGER NOT NULL, state TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS teams (id TEXT PRIMARY KEY, room_code TEXT NOT NULL, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS players (id TEXT PRIMARY KEY, room_code TEXT NOT NULL, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS questions (id TEXT PRIMARY KEY, room_code TEXT NOT NULL, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS answers (id TEXT PRIMARY KEY, room_code TEXT NOT NULL, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS game_events (id TEXT PRIMARY KEY, room_code TEXT NOT NULL, data TEXT NOT NULL, before_state TEXT, after_state TEXT);
CREATE TABLE IF NOT EXISTS game_turns (id TEXT PRIMARY KEY, room_code TEXT NOT NULL, data TEXT NOT NULL);
`;
function rows(s) {
  return {
    teams: Object.values(s.teams).map((x) => [`${s.code}:${x.id}`, x]),
    players: Object.values(s.players).map((x) => [x.id, x]),
    questions: s.questions.map((x) => [x.id, x]),
    answers: s.quiz
      ? Object.entries(s.quiz.answers).map(([id, a]) => [
          `${s.quiz.id}:${id}`,
          {
            ...a,
            playerId: id,
            questionId: s.quiz.question.id,
            quizId: s.quiz.id,
            team: s.currentTeam,
          },
        ])
      : [],
    game_events: s.events.map((e) => [e.id, e]),
    game_turns: [
      [
        `${s.code}:${s.turnId}`,
        {
          turnId: s.turnId,
          team: s.currentTeam,
          round: s.round,
          dice: s.dice,
          phase: s.phase,
        },
      ],
    ],
  };
}
function auditState(s) {
  return s
    ? {
        status: s.status,
        phase: s.phase,
        teams: s.teams,
        turnId: s.turnId,
        currentTeam: s.currentTeam,
        dice: s.dice,
        quiz: s.quiz
          ? {
              id: s.quiz.id,
              submitted: Object.keys(s.quiz.answers).length,
              result: s.quiz.result,
            }
          : null,
      }
    : null;
}
function differences(s, before) {
  const afterRows = rows(s),
    beforeRows = before ? rows(before) : {},
    out = [];
  for (const table of projections) {
    const old = new Map(
      (beforeRows[table] || []).map(([id, row]) => [id, encoded(row)]),
    );
    for (const [id, row] of afterRows[table])
      if (encoded(row) !== old.get(id))
        out.push([table, `${s.code}:${id}`, row]);
    // Keep historical answers/turns/events; questions are explicitly removable.
    if (table === "questions")
      for (const id of old.keys())
        if (!afterRows[table].some(([key]) => key === id))
          out.push([table, `${s.code}:${id}`, null]);
  }
  return out;
}
export async function createStore({
  databaseUrl = process.env.DATABASE_URL,
  file = process.env.DATA_FILE || "data/game.sqlite",
} = {}) {
  const queues = new Map();
  const queue = (code, fn) => {
    const previous = queues.get(code) || Promise.resolve();
    const next = previous.catch(() => {}).then(fn);
    queues.set(code, next);
    void next
      .finally(() => {
        if (queues.get(code) === next) queues.delete(code);
      })
      .catch(() => {});
    return next;
  };
  if (databaseUrl) {
    const pool = new pg.Pool({ connectionString: databaseUrl, max: 8 });
    await pool.query("SELECT code FROM public.game_rooms LIMIT 1");
    return {
      kind: "postgresql",
      async read(code) {
        const { rows } = await pool.query(
          "SELECT state FROM public.game_rooms WHERE code=$1",
          [code],
        );
        return rows[0] ? decoded(rows[0].state) : null;
      },
      async codes() {
        return (
          await pool.query("SELECT code FROM public.game_rooms")
        ).rows.map((x) => x.code);
      },
      mutate(code, fn) {
        return queue(code, async () => {
          const client = await pool.connect();
          try {
            await client.query("BEGIN");
            // Advisory lock also serializes creation of a not-yet-existing room.
            await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
              code,
            ]);
            const { rows } = await client.query(
              "SELECT state FROM public.game_rooms WHERE code=$1 FOR UPDATE",
              [code],
            );
            const previous = rows[0] ? decoded(rows[0].state) : null;
            const state = previous ? structuredClone(previous) : null;
            const result = fn(state);
            const next = result?.state ?? state;
            if (next) {
              next.version = (previous?.version ?? 0) + 1;
              await client.query(
                "INSERT INTO public.game_rooms(code,version,state) VALUES($1,$2,$3) ON CONFLICT(code) DO UPDATE SET version=EXCLUDED.version,state=EXCLUDED.state",
                [code, next.version, encoded(next)],
              );
              for (const [table, id, row] of differences(next, previous)) {
                if (row === null)
                  await client.query(
                    `DELETE FROM public.${table} WHERE id=$1 AND room_code=$2`,
                    [id, code],
                  );
                else if (table === "game_events")
                  await client.query(
                    "INSERT INTO public.game_events(id,room_code,data,before_state,after_state) VALUES($1,$2,$3,$4,$5) ON CONFLICT(id) DO NOTHING",
                    [
                      id,
                      code,
                      encoded(row),
                      encoded(auditState(previous)),
                      encoded(auditState(next)),
                    ],
                  );
                else
                  await client.query(
                    `INSERT INTO public.${table}(id,room_code,data) VALUES($1,$2,$3) ON CONFLICT(id) DO UPDATE SET data=EXCLUDED.data`,
                    [id, code, encoded(row)],
                  );
              }
            }
            await client.query("COMMIT");
            return result?.value ?? next;
          } catch (e) {
            await client.query("ROLLBACK");
            throw e;
          } finally {
            client.release();
          }
        });
      },
      close: () => pool.end(),
    };
  }
  const SQL = await initSqlJs(),
    absolute = path.resolve(file);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  // An operator can stage a complete backup beside the database and restart.
  // Validate it before touching the live file; consume the restore only once.
  const pendingRestore = absolute + ".restore";
  if (fs.existsSync(pendingRestore)) {
    const bytes = fs.readFileSync(pendingRestore);
    if (bytes.subarray(0, 16).toString() !== "SQLite format 3\0")
      throw new Error("数据库备份格式无效，原数据库未修改");
    const restored = new SQL.Database(bytes);
    try {
      if (restored.exec("PRAGMA integrity_check")[0]?.values[0]?.[0] !== "ok")
        throw new Error("数据库备份完整性检查失败，原数据库未修改");
      const tables = new Set(restored.exec("SELECT name FROM sqlite_master WHERE type='table'")[0]?.values.map(([name]) => name));
      if (!["game_rooms", ...projections].every((name) => tables.has(name)))
        throw new Error("数据库备份缺少游戏数据表，原数据库未修改");
      for (const [code, version, json] of restored.exec("SELECT code, version, state FROM game_rooms")[0]?.values || []) {
        const state = decoded(json);
        if (state?.code !== code || state.version !== version || !state.teams || !state.players || !Array.isArray(state.questions) || !Array.isArray(state.events))
          throw new Error("数据库备份包含无效房间，原数据库未修改");
      }
    } finally {
      restored.close();
    }
    if (fs.existsSync(absolute))
      fs.copyFileSync(absolute, `${absolute}.before-restore-${Date.now()}`, fs.constants.COPYFILE_EXCL);
    fs.renameSync(pendingRestore, absolute);
    console.log("已从经过验证的备份恢复SQLite数据");
  }
  let db = new SQL.Database(
    fs.existsSync(absolute) ? fs.readFileSync(absolute) : undefined,
  );
  db.run(sqliteSchema);
  let durableBytes;
  const sqliteWriteKey = Symbol("sqlite writes");
  const waitForWrites = async () => {
    while (queues.has(sqliteWriteKey)) {
      const pending = queues.get(sqliteWriteKey);
      await pending.catch(() => {});
      if (queues.get(sqliteWriteKey) === pending) break;
    }
  };
  const persist = async () => {
    const tmp = absolute + ".tmp";
    const bytes = Buffer.from(db.export());
    const file = await fs.promises.open(tmp, "w", 0o600);
    try {
      await file.writeFile(bytes);
      await file.sync();
    } finally {
      await file.close();
    }
    await fs.promises.rename(tmp, absolute);
    durableBytes = bytes;
  };
  await persist();
  // Readers see only states whose file sync and rename have completed. Waiting
  // for the whole write queue to drain can starve login and broadcasts while
  // players keep joining; reading the mutable database can expose a write that
  // later fails. Keep the last durable JSON for each room instead.
  const committedRooms = new Map(
    db.exec("SELECT code, state FROM game_rooms")[0]?.values ?? [],
  );
  const read = (code) => {
    const stmt = db.prepare("SELECT state FROM game_rooms WHERE code=?");
    try {
      stmt.bind([code]);
      return stmt.step() ? decoded(stmt.getAsObject().state) : null;
    } finally {
      stmt.free();
    }
  };
  return {
    kind: "sqlite",
    read: async (code) => {
      const state = committedRooms.get(code);
      return state === undefined ? null : decoded(state);
    },
    codes: async () => [...committedRooms.keys()],
    mutate(code, fn) {
      // One SQLite file needs one write queue even when different rooms write.
      // Filesystem I/O yields to the event loop; acknowledgement still waits for
      // fsync and atomic rename, so a successful command remains durable.
      return queue(sqliteWriteKey, async () => {
        const before = read(code),
          state = before ? structuredClone(before) : null;
        const result = fn(state),
          next = result?.state ?? state;
        if (!next) throw new GameError("房间不存在", 404);
        next.version = (before?.version ?? 0) + 1;
        try {
          const stateJson = encoded(next);
          db.run("BEGIN IMMEDIATE");
          db.run(
            "INSERT INTO game_rooms(code,version,state) VALUES(?,?,?) ON CONFLICT(code) DO UPDATE SET version=excluded.version,state=excluded.state",
            [code, next.version, stateJson],
          );
          for (const [table, id, row] of differences(next, before)) {
            if (row === null)
              db.run(`DELETE FROM ${table} WHERE id=? AND room_code=?`, [
                id,
                code,
              ]);
            else if (table === "game_events")
              db.run(
                "INSERT OR IGNORE INTO game_events(id,room_code,data,before_state,after_state) VALUES(?,?,?,?,?)",
                [
                  id,
                  code,
                  encoded(row),
                  encoded(auditState(before)),
                  encoded(auditState(next)),
                ],
              );
            else
              db.run(
                `INSERT INTO ${table}(id,room_code,data) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data`,
                [id, code, encoded(row)],
              );
          }
          db.run("COMMIT");
          await persist();
          committedRooms.set(code, stateJson);
        } catch (e) {
          try {
            db.run("ROLLBACK");
          } catch {
            /* COMMIT may already have completed. */
          }
          db.close();
          db = new SQL.Database(durableBytes);
          throw e;
        }
        return result?.value ?? next;
      });
    },
    close: async () => {
      await waitForWrites();
      await persist();
      db.close();
    },
  };
}
