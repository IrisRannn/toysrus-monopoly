// Loopback-only browser fixture. It is never imported by the production server.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createApp } from "../server/index.js";
import { createStore } from "../server/lib/store.js";
const directory = await fs.mkdtemp(path.join(os.tmpdir(), "monopoly-browser-"));
const store = await createStore({
  databaseUrl: null,
  file: path.join(directory, "state.sqlite"),
});
let milliseconds = 0;
const mutate = store.mutate.bind(store);
store.mutate = async (...args) => {
  if (milliseconds) await delay(milliseconds);
  return mutate(...args);
};
const app = await createApp({ store, assetDirectory: path.join(directory, "assets") });
app.app.post("/_test/delay", (req, res) => {
  milliseconds = Math.min(1000, Math.max(0, Number(req.body.ms) || 0));
  res.json({ ok: true });
});
app.server.listen(Number(process.env.FIXTURE_PORT || 3003), "127.0.0.1", () =>
  console.log("Browser delay fixture ready"),
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(
    signal,
    () =>
      void app
        .close()
        .then(() => fs.rm(directory, { recursive: true, force: true }))
        .then(() => process.exit(0)),
  );
