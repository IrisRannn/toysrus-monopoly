import { test, mock } from "node:test";
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

test("SQLite reads the last durable state while a newer write is awaiting disk sync", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "monopoly-store-read-"));
  const file = path.join(directory, "state.sqlite");
  const store = await createStore({ databaseUrl: null, file });
  const entered = Promise.withResolvers();
  const release = Promise.withResolvers();
  let write, openMock, timer;
  try {
    await store.mutate("123456", () => ({ state: newRoom("123456", "host") }));
    const open = fs.open.bind(fs);
    let gated = false;
    openMock = mock.method(fs, "open", async (...args) => {
      const handle = await open(...args);
      if (!gated && args[0] === file + ".tmp") {
        gated = true;
        const sync = handle.sync.bind(handle);
        handle.sync = async () => {
          entered.resolve();
          await release.promise;
          return sync();
        };
      }
      return handle;
    });
    write = store.mutate("123456", (state) => { state.round = 2; });
    await entered.promise;
    const state = await Promise.race([
      store.read("123456"),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("A read was blocked by an unfinished write")), 750);
      }),
    ]);
    assert.equal(state.round, 1, "Unacknowledged changes must not be visible");
    assert.deepEqual(await store.codes(), ["123456"]);
    state.round = 99;
    assert.equal((await store.read("123456")).round, 1, "Readers cannot change stored state");
    release.resolve();
    await write;
    assert.equal((await store.read("123456")).round, 2);
  } finally {
    clearTimeout(timer);
    release.resolve();
    if (write) await write.catch(() => {});
    openMock?.mock.restore();
    await store.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("SQLite restores a staged backup once and keeps the previous database for rollback", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "monopoly-restore-"));
  const source = path.join(directory, "backup.sqlite");
  const file = path.join(directory, "state.sqlite");
  let store = await createStore({ databaseUrl: null, file: source });
  try {
    await store.mutate("261218", () => ({ state: newRoom("261218", "original-host") }));
    await store.mutate("261218", (s) => {
      s.questions.push({ id: "custom-restored", tile: 0, text: "备份中的自定义题目", options: { A: "甲", B: "乙", C: "丙", D: "丁" }, answer: "B", explanation: "保留答案" });
      s.teams.east.position = 9;
    });
    const expected = await store.read("261218");
    await store.close();
    store = await createStore({ databaseUrl: null, file });
    await store.mutate("261218", () => ({ state: newRoom("261218", "new-host") }));
    await store.close();
    const previous = await fs.readFile(file);
    await fs.copyFile(source, file + ".restore");

    store = await createStore({ databaseUrl: null, file });
    assert.deepEqual(await store.read("261218"), expected);
    await assert.rejects(fs.access(file + ".restore"), { code: "ENOENT" });
    const backups = (await fs.readdir(directory)).filter((name) => name.startsWith("state.sqlite.before-restore-"));
    assert.equal(backups.length, 1);
    assert.deepEqual(await fs.readFile(path.join(directory, backups[0])), previous);
    await store.mutate("261218", (s) => { s.round = 4; });
    await store.close();
    store = await createStore({ databaseUrl: null, file });
    assert.equal((await store.read("261218")).round, 4, "A consumed backup must not restore again");
  } finally {
    await store.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("SQLite refuses an invalid staged restore without changing the current database", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "monopoly-invalid-restore-"));
  const file = path.join(directory, "state.sqlite");
  const store = await createStore({ databaseUrl: null, file });
  try {
    await store.mutate("261218", () => ({ state: newRoom("261218", "host") }));
    await store.close();
    const previous = await fs.readFile(file);
    await fs.writeFile(file + ".restore", "This is not a SQLite backup");
    await assert.rejects(createStore({ databaseUrl: null, file }), /备份格式无效/);
    assert.deepEqual(await fs.readFile(file), previous);
    await fs.access(file + ".restore");
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
