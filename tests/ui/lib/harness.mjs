// Launch Craidd Studio under tauri-driver with a scratch HOME and collect evidence.
// Runs only when asked (docs/uiux/design-ui-test-harness.md, H2).

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { WebDriver } from "./webdriver.mjs";

export const ROOT = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
export const APP = join(ROOT, "src-tauri/target/debug/craidd-studio");
export const lab = (name) => join(ROOT, "workspaces", name, `${name}.cln`);

const RUN = new Date().toISOString().replace(/[:.]/g, "-");

function findDriver() {
  const candidates = [process.env.TAURI_DRIVER, join(process.env.CARGO_HOME ?? join(homedir(), ".cargo"), "bin/tauri-driver")];
  for (const path of (process.env.PATH ?? "").split(":")) candidates.push(join(path, "tauri-driver"));
  const found = candidates.find((path) => path && existsSync(path));
  if (!found) throw new Error("tauri-driver not found. Install it with: cargo install tauri-driver --locked");
  return found;
}

async function waitForPort(base, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { await fetch(base + "/status", { signal: AbortSignal.timeout(1000) }); return; }
    catch { await new Promise((r) => setTimeout(r, 200)); }
  }
  throw new Error("tauri-driver did not start");
}

/** Start the app. `scenario` names the evidence folder. */
export async function launch(scenario, { port = 4444 } = {}) {
  if (!existsSync(APP)) throw new Error(`No embedded debug build at ${APP}. Run: npm run test:ui:build`);
  const dir = join(ROOT, "test-results/ui", RUN, scenario);
  const home = join(dir, "home");
  await mkdir(home, { recursive: true });
  const env = {
    ...process.env, HOME: home,
    CARGO_HOME: process.env.CARGO_HOME ?? join(homedir(), ".cargo"),
    RUSTUP_HOME: process.env.RUSTUP_HOME ?? join(homedir(), ".rustup"),
    CRAIDD_TRACE_TITLES: "1",
  };
  const log = [];
  const driver = spawn(findDriver(), ["--port", String(port)], { env, stdio: ["ignore", "pipe", "pipe"] });
  for (const stream of [driver.stdout, driver.stderr]) {
    stream.setEncoding("utf8");
    let partial = "";
    stream.on("data", (chunk) => {
      const lines = (partial + chunk).split("\n");
      partial = lines.pop() ?? "";
      log.push(...lines.filter(Boolean));
    });
  }
  const base = `http://127.0.0.1:${port}`;
  await waitForPort(base, 10_000);
  const wd = await WebDriver.connect(base, APP);
  const records = [];

  const app = {
    wd, dir, log, records,
    /** Call a Tauri command from the page (the window's own IPC permissions apply). */
    invoke: (command, args = {}) => wd.executeAsync(
      "const [c, a, done] = arguments; window.__TAURI_INTERNALS__.invoke(c, a).then((v) => done({ ok: v }), (e) => done({ error: String(e) }));",
      [command, args]).then((result) => { if (result && "error" in result) throw new Error(`${command}: ${result.error}`); return result?.ok; }),
    async screenshot(name) {
      const png = await wd.screenshot();
      const file = join(dir, `${name}.png`);
      await writeFile(file, Buffer.from(png, "base64"));
      return file;
    },
    record(step, data) { records.push({ step, at: new Date().toISOString(), ...data }); },
    async waitFor(description, probe, timeoutMs = 20_000, intervalMs = 250) {
      const deadline = Date.now() + timeoutMs;
      let last;
      while (Date.now() < deadline) {
        last = await probe().catch((error) => ({ error: String(error) }));
        if (last && last.done) return last.value;
        await new Promise((r) => setTimeout(r, intervalMs));
      }
      throw new Error(`Timed out: ${description}. Last: ${JSON.stringify(last)}`);
    },
    async close() {
      await wd.quit();
      driver.kill("SIGTERM");
      await new Promise((r) => setTimeout(r, 500));
      await writeFile(join(dir, "record.json"), JSON.stringify({ records, log }, null, 2));
    },
  };
  return app;
}
