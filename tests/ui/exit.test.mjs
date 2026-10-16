// Scenario 5: Exit → This Application ends the app (§6).
import { test } from "node:test";
import assert from "node:assert/strict";
import { processIdentity, launch, openLab, switchToLabel } from "./lib/harness.mjs";


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
  const host=await app.hostIdentity();
  app.record("before-exit", { host });

  await app.wd.execute(`window.dispatchEvent(new CustomEvent("craidd:exit-scope", { detail: "ide" }));`);
  await app.waitFor("exit dialog", async () => ({ done: await app.wd.execute(CLICK, ["Close"]), value: true }), 15_000)
    .catch(async (error) => { await app.screenshot("exit-dialog-missing"); throw error; });
  exited = true;

  const left = await app.waitFor("app process ends", async () => {
    const process = await processIdentity(host.pid).catch(()=>null);
    return { done: !process || process.birth!==host.birth || process.state==="Z", value: process };
  }, 15_000).catch((error) => { app.record("still-running", { host }); throw error; });
  app.record("after-exit", { processes: left, second });
});
