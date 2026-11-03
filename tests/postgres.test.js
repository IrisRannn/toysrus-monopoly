import { test } from "node:test";
import assert from "node:assert/strict";
import { randomInt } from "node:crypto";
import pg from "pg";
import { createStore } from "../server/lib/store.js";
import { newRoom, command, tick, publicState } from "../server/lib/engine.js";
const url = process.env.TEST_DATABASE_URL;
// Optional external integration; the same migration must have been applied first.
test(
  "PostgreSQL row locks serialize two independent connections; 10 votes, restart, audit and anonymous denial",
  { skip: !url },
  async () => {
    const first = await createStore({ databaseUrl: url }),
      second = await createStore({ databaseUrl: url }),
      pool = new pg.Pool({ connectionString: url });
    const code = String(randomInt(100000, 1000000)),
      host = { role: "host" },
      now = Date.now();
    try {
      await first.mutate(code, () => ({ state: newRoom(code, "hosthash") }));
      await first.mutate(code, (s) => {
        s.players.rep = { id: "rep", nickname: "代表", team: "east" };
        command(s, host, "start", {}, now);
        command(
          s,
          { role: "player", playerId: "rep" },
          "claimRepresentative",
          {},
          now,
        );
      });
      const attempts = await Promise.allSettled(
        Array.from({ length: 20 }, (_, i) =>
          (i % 2 ? first : second).mutate(code, (s) =>
            command(
              s,
              { role: "player", playerId: "rep" },
              "roll",
              {},
              now,
              () => 4,
            ),
          ),
        ),
      );
      assert.equal(attempts.filter((x) => x.status === "fulfilled").length, 1);
      await first.mutate(code, (s) => {
        tick(s, s.transitionAt);
        tick(s, s.transitionAt);
        command(
          s,
          host,
          "saveQuestion",
          {
            id: "pg-test-question",
            tile: 4,
            text: "数据库并发测试题",
            options: { A: "甲", B: "乙", C: "丙", D: "丁" },
            answer: "A",
          },
          now,
        );
        command(s, host, "startQuiz", { questionId: "pg-test-question" }, now);
        for (let i = 0; i < 10; i++)
          s.players["v" + i] = {
            id: "v" + i,
            nickname: "员工" + i,
            team: "east",
          };
      });
      await Promise.all(
        Array.from({ length: 10 }, (_, i) =>
          (i % 2 ? first : second).mutate(code, (s) =>
            command(
              s,
              { role: "player", playerId: "v" + i },
              "answer",
              { option: i < 4 ? "A" : i < 7 ? "B" : i < 9 ? "C" : "D" },
              now + 1,
            ),
          ),
        ),
      );
      const state = await second.read(code);
      assert.equal(Object.keys(state.quiz.answers).length, 10);
      assert.deepEqual(publicState(state, host).quiz.counts, {
        A: 4,
        B: 3,
        C: 2,
        D: 1,
      });
      const saved = (
        await pool.query(
          "SELECT count(*)::int n FROM public.answers WHERE room_code=$1",
          [code],
        )
      ).rows[0].n;
      assert.equal(saved, 10);
      const position = (
        await pool.query(
          "SELECT position FROM public.teams WHERE room_code=$1 AND team_key='east'",
          [code],
        )
      ).rows[0].position;
      assert.equal(position, 4);
      const audit = (
        await pool.query(
          "SELECT before_state,after_state FROM public.game_events WHERE room_code=$1 LIMIT 1",
          [code],
        )
      ).rows[0];
      assert(audit.before_state);
      assert(audit.after_state);
      const client = await pool.connect();
      try {
        await client.query("SET ROLE anon");
        await assert.rejects(
          () => client.query("SELECT data FROM public.questions"),
          (error) => error.code === "42501",
        );
      } finally {
        await client.query("RESET ROLE");
        client.release();
      }
      await first.close();
      const restored = await createStore({ databaseUrl: url });
      assert.equal(
        Object.keys((await restored.read(code)).quiz.answers).length,
        10,
      );
      await restored.close();
    } finally {
      await pool.query("DELETE FROM public.game_rooms WHERE code=$1", [code]);
      await second.close();
      await pool.end();
    }
  },
);
