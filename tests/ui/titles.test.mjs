// Scenario 1: window titles (sweep §1 acceptance, R2).
import { test } from "node:test";
import assert from "node:assert/strict";
import { launch, lab } from "./lib/harness.mjs";

const LINKED = /^(?:.+: )?CS(\d+) - Craidd Studio - Multi-Thread Lab$/;

test("solution windows reach the canonical title after registering", { timeout: 180_000 }, async (t) => {
  const app = await launch("titles");
  t.after(() => app.close());
  const titleOf = (label) => app.invoke("plugin:window|title", { label });

  app.record("get-started", { title: await titleOf("main") });
  await app.screenshot("01-get-started");

  const open = () => app.invoke("open_workspace_window", { entry: {
    path: lab("mt-lab"), kind: "solution", name: "mt-lab", windowLabel: "",
  } });

  const seen = async (label) => {
    const history = [];
    const title = await app.waitFor(`${label} canonical title`, async () => {
      const value = await titleOf(label);
      if (history.at(-1) !== value) history.push(value);
      return { done: LINKED.test(value), value };
    }, 30_000).catch((error) => { app.record(`${label}-failed`, { history }); throw error; });
    app.record(label, { history });
    return title;
  };

  const first = await open();
  const firstTitle = await seen(first);
  const second = await open();
  const secondTitle = await seen(second);

  // Hide is GUI teardown; Show recreates the window, which must reach its title again.
  // Linked commands must come from a window in the solution, so drive the second window.
  const handles = await app.wd.windowHandles();
  app.record("handles", { handles });
  let driven = null;
  for (const handle of handles) {
    await app.wd.switchTo(handle);
    const label = await app.wd.execute("return window.__TAURI_INTERNALS__.metadata.currentWindow.label;");
    if (label === second) { driven = handle; break; }
  }
  assert.ok(driven, `WebDriver can reach ${second} (handles: ${handles.length})`);
  await app.invoke("set_linked_window_visible", { targetLabel: first, visible: false });
  await app.waitFor(`${first} hidden`, async () => {
    const windows = await app.invoke("get_application_windows");
    return { done: windows.some((item) => item.windowLabel === first && !item.visible), value: true };
  });
  await app.invoke("set_linked_window_visible", { targetLabel: first, visible: true });
  const shownTitle = await seen(first);
  assert.equal(shownTitle, firstTitle, "a shown window gets its canonical title back");

  const ids = [firstTitle, secondTitle].map((title) => Number(LINKED.exec(title)[1]));
  assert.notEqual(ids[0], ids[1], "each window has its own CS number");
  assert.equal(await titleOf(first), firstTitle, "opening a second window leaves the first title unchanged");
});
