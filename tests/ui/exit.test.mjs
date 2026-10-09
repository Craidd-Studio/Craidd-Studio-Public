// Scenario 5: Exit → This Application ends the app (§6).
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { APP, launch, openLab, switchToLabel } from "./lib/harness.mjs";

const running = () => {
  try { return execFileSync("pgrep", ["-f", "-x", APP], { encoding: "utf8" }).trim().split("\n").filter(Boolean); }
  catch { return []; }
};

const CLICK = `
  const [text] = arguments;
  const button = [...document.querySelectorAll("button")].find((el) => el.textContent.trim() === text && !el.disabled);
  if (!button) return false;
  button.click();
  return true;
`;

test("Exit → This Application closes every window, including a hidden one", { timeout: 180_000 }, async (t) => {
  const app = await launch("exit");
  let exited = false;
  t.after(async () => { if (!exited) await app.close(); else await app.close().catch(() => {}); });

  const first = await openLab(app, "mt-lab");
  await switchToLabel(app, "main");
  const second = await openLab(app, "mt-lab");
  await app.invoke("set_linked_window_visible", { targetLabel: first, visible: false });
  await app.waitFor(`${first} hidden`, async () => {
    const windows = await app.invoke("get_application_windows");
    return { done: windows.some((item) => item.windowLabel === first && !item.visible), value: true };
  });
  assert.ok(running().length > 0, "the app is running before exit");
  app.record("before-exit", { processes: running() });

  await app.wd.execute(`window.dispatchEvent(new CustomEvent("craidd:exit-scope", { detail: "ide" }));`);
  await app.waitFor("exit dialog", async () => ({ done: await app.wd.execute(CLICK, ["Close"]), value: true }), 15_000)
    .catch(async (error) => { await app.screenshot("exit-dialog-missing"); throw error; });
  exited = true;

  const left = await app.waitFor("app process ends", async () => {
    const processes = running();
    return { done: processes.length === 0, value: processes };
  }, 15_000).catch((error) => { app.record("still-running", { processes: running() }); throw error; });
  app.record("after-exit", { processes: left, second });
});
