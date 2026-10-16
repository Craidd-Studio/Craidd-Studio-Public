// Launch Craidd Studio under tauri-driver with a scratch HOME and collect evidence.
// Runs only when asked (docs/uiux/design-ui-test-harness.md, H2).

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, writeFile, readdir, readFile, readlink } from "node:fs/promises";
import { homedir } from "node:os";
import { createServer } from "node:net";
import { randomUUID } from "node:crypto";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { WebDriver } from "./webdriver.mjs";

export const ROOT = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
export const APP = process.env.CRAIDD_UI_APP ?? join(ROOT, "src-tauri/target/debug/craidd-studio");
export const lab = (name) => join(ROOT, "workspaces", name, `${name}.cln`);

const RUN = new Date().toISOString().replace(/[:.]/g, "-");

export function discoveryDirectory(namespace) {
  let hash = 0xcbf29ce484222325n;
  for (const byte of Buffer.from(namespace)) hash = ((hash ^ BigInt(byte)) * 0x100000001b3n) & 0xffffffffffffffffn;
  return join(process.env.XDG_RUNTIME_DIR ?? `/run/user/${process.getuid()}`, "craidd-profiling", `n${hash.toString(16).padStart(16,"0")}`);
}
export async function processIdentity(pid) {
  const tail = (await readFile(`/proc/${pid}/stat`,"utf8")).split(")").at(-1).trim().split(/\s+/);
  return { pid:Number(pid), birth:Number(tail[19]), parent:Number(tail[1]), state:tail[0] };
}
async function ownedHost(app) {
  for (const name of await readdir(discoveryDirectory(app.namespace))) {
    const match = /^host-(\d+)-(\d+)\.sock$/.exec(name);
    if (!match) continue;
    const identity = await processIdentity(match[1]).catch(()=>null);
    if (!identity || identity.birth !== Number(match[2])) continue;
    if ((await readlink(`/proc/${identity.pid}/exe`)).replace(/ \(deleted\)$/," ").trim() !== APP) continue;
    let parent = identity.parent;
    for (let n=0;n<12 && parent>1;n++) {
      if (parent===app.driverPid) return identity;
      const p=await processIdentity(parent).catch(()=>null);if(!p)break;parent=p.parent;
    }
  }
  throw new Error("No app process proven to belong to this driver and namespace");
}

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

export async function evidenceDirectory(scenario) {
  const dir = join(ROOT, "test-results/ui", RUN, scenario);
  await mkdir(dir, { recursive: true });
  return dir;
}

/** Start the app. `scenario` names the evidence folder. */
export async function launch(scenario, { port = 0, environment = {} } = {}) {
  async function freePort() {
    const probe = createServer();
    await new Promise((resolve, reject) => { probe.once("error", reject); probe.listen(0, "127.0.0.1", resolve); });
    const number = probe.address().port;
    await new Promise(resolve => probe.close(resolve));
    return number;
  }
  if (!port) port = await freePort();
  const nativePort = await freePort();
  if (!existsSync(APP)) throw new Error(`No embedded debug build at ${APP}. Run: npm run test:ui:build`);
  const dir = await evidenceDirectory(scenario);
  const home = join(dir, "home");
  await mkdir(home, { recursive: true });
  const env = {
    ...process.env, ...environment, HOME: home,
    XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR ?? `/run/user/${process.getuid()}`,
    XDG_CONFIG_HOME: join(home, ".config"),
    XDG_CACHE_HOME: join(home, ".cache"),
    XDG_DATA_HOME: join(home, ".local/share"),
    CRAIDD_PROFILE_NAMESPACE: environment.CRAIDD_PROFILE_NAMESPACE ?? `ui-${randomUUID()}`,
    CARGO_HOME: process.env.CARGO_HOME ?? join(homedir(), ".cargo"),
    RUSTUP_HOME: process.env.RUSTUP_HOME ?? join(homedir(), ".rustup"),
    CRAIDD_TRACE_TITLES: "1",
  };
  const log = [];
  const driver = spawn(findDriver(), ["--port", String(port), "--native-port", String(nativePort)], { env, stdio: ["ignore", "pipe", "pipe"] });
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
  let wd;
  try { wd = await WebDriver.connect(base, APP); }
  catch (error) { driver.kill("SIGTERM"); await writeFile(join(dir, "startup-error.json"), JSON.stringify({ error: String(error), log }, null, 2)); throw error; }
  const records = [];

  const app = {
    wd, dir, home, log, records, driverPid: driver.pid, namespace: env.CRAIDD_PROFILE_NAMESPACE,
    /** Call a Tauri command from the page (the window's own IPC permissions apply). */
    hostIdentity: () => ownedHost(app),
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
      if (!app.crashed) {
        await app.screenshot("final-state").catch(() => {});
        await app.invoke("get_profile").then(profile => app.record("final-profile", { profile })).catch(() => {});
      }
      await wd.quit();
      driver.kill("SIGTERM");
      await new Promise((r) => setTimeout(r, 500));
      await writeFile(join(dir, "record.json"), JSON.stringify({ records, log }, null, 2));
    },
  };
  return app;
}

/** Open a lab solution in a new window, wait until it registers, and drive it. Returns its label. */
export async function openLab(app, name) {
  return openSolution(app, lab(name), name);
}

export async function openSolution(app, path, name = "Disposable UI lab") {
  const label = await app.invoke("open_workspace_window", { entry: { path, kind: "solution", name, windowLabel: "" } });
  await app.waitFor(`${label} registered`, async () => {
    const title = await app.invoke("plugin:window|title", { label });
    return { done: / - Craidd Studio - /.test(title) && /CS\d+/.test(title), value: title };
  }, 30_000);
  await switchToLabel(app, label);
  await app.waitFor(`${label} explorer ready`, async () => ({
    done: await app.wd.execute("return !!document.querySelector('[class*=\"uppercase\"]') && document.body.innerText.includes('File Discovery');"),
    value: true,
  }));
  return label;
}

/** Point WebDriver at the window with this Tauri label. */
export async function switchToLabel(app, label) {
  for (const handle of await app.wd.windowHandles()) {
    await app.wd.switchTo(handle);
    if (await app.wd.execute("return window.__TAURI_INTERNALS__.metadata.currentWindow.label;") === label) return handle;
  }
  throw new Error(`No WebDriver handle for ${label}`);
}
