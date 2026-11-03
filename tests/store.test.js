import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createStore } from "../server/lib/store.js";
import { newRoom } from "../server/lib/engine.js";

test("SQLite serializes writes across rooms and restores the last durable state after an I/O failure", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "monopoly-store-"));
  const file = path.join(directory, "state.sqlite");
  let store = await createStore({ databaseUrl: null, file });
  try {
    for (const code of ["123456", "654321"])
      await store.mutate(code, () => ({ state: newRoom(code, "host") }));
    await Promise.all(
      Array.from({ length: 24 }, (_, i) =>
        store.mutate(i % 2 ? "123456" : "654321", (s) => {
          s.round++;
        }),
      ),
    );
    assert.equal((await store.read("123456")).round, 13);
    assert.equal((await store.read("654321")).round, 13);
    await fs.mkdir(file + ".tmp");
    await assert.rejects(() =>
      store.mutate("123456", (s) => {
        s.round = 99;
      }),
    );
    assert.equal((await store.read("123456")).round, 13);
    assert.equal((await store.read("654321")).round, 13);
    await fs.rmdir(file + ".tmp");
    await store.mutate("123456", (s) => {
      s.round++;
    });
    await store.close();
    store = await createStore({ databaseUrl: null, file });
    assert.equal((await store.read("123456")).round, 14);
    assert.equal((await store.read("654321")).round, 13);
  } finally {
    await store.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
});
