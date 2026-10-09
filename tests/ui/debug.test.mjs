// Scenarios 3 and 4: debug keys, Watch and hover against netcoredbg (§2, §5, R1).
import { test } from "node:test";
import assert from "node:assert/strict";
import { launch, openLab } from "./lib/harness.mjs";
import { WebDriver } from "./lib/webdriver.mjs";

const { F5, F9, F10, SHIFT } = WebDriver.KEYS;
const HOVER_COLUMN = 23; // inside "number" in `        int marker = number * 10;`
const BREAK_LINE = "//div[contains(@class,'view-line')][contains(., 'BREAK_CS_BASIC')]";

// The debug sidebar's session status and the paused line, as the user sees them.
const SESSION = `
  const label = [...document.querySelectorAll("div")].find((el) => el.textContent.trim() === "Session");
  const block = label && label.parentElement;
  const lines = block ? [...block.children].slice(1).map((el) => el.textContent.trim()) : [];
  return { status: lines[0] ?? null, where: lines[1] ?? null, reason: lines[2] ?? null };
`;
const WATCH_VALUE = `
  const [expression] = arguments;
  const label = [...document.querySelectorAll("div")].find((el) => el.textContent.trim() === "Watch");
  const row = label && [...label.parentElement.querySelectorAll("span")].find((el) => el.textContent.trim() === expression);
  return row ? row.parentElement.textContent.replace(expression, "").replace(/[▸▾×]/g, "").trim() : null;
`;

test("C# console: F9, F5, Watch, hover, F10 and Shift+F5", { timeout: 300_000 }, async (t) => {
  const app = await launch("debug-csharp");
  t.after(() => app.close());
  await openLab(app, "mt-lab");

  const session = () => app.wd.execute(SESSION);
  const program = await app.wd.find("(//*[normalize-space(text())='Program.cs'])[1]");
  await app.wd.click(program);
  const line = await app.waitFor("Program.cs open", async () => ({ done: true, value: await app.wd.find(BREAK_LINE) }), 20_000);
  // Drive Monaco by keyboard: under WebDriver its line DOM reports positions that do not match
  // what is painted, so pointer coordinates are unreliable.
  const goTo = async (position) => {
    await app.wd.execute(`document.querySelector(".monaco-editor textarea").focus();`);
    await app.wd.keys([WebDriver.KEYS.CONTROL, "g"]);
    await new Promise((r) => setTimeout(r, 300));
    await app.wd.keys(...position.split(""), WebDriver.KEYS.ENTER);
    await new Promise((r) => setTimeout(r, 200));
  };
  await goTo("21");
  await app.wd.keys(F9);
  await app.waitFor("breakpoint listed", async () => ({
    done: await app.wd.execute(`return document.body.innerText.includes("Program.cs:21");`), value: true,
  }), 10_000).catch(async (error) => {
    await app.screenshot("no-breakpoint");
    app.record("focus", await app.wd.execute(`const a = document.activeElement; return { tag: a?.tagName, cls: a?.className, text: document.body.innerText.slice(0, 2000) };`));
    throw error;
  });

  await app.wd.keys(F5);
  const paused = await app.waitFor("paused at BREAK_CS_BASIC", async () => {
    const value = await session();
    return { done: value.status === "paused" && /:21$/.test(value.where ?? ""), value };
  }, 180_000, 500).catch(async (error) => { await app.screenshot("not-paused"); app.record("session", await session()); throw error; });
  app.record("paused", paused);
  await app.screenshot("01-paused");

  // A held F5 must not start a second session: pressing F5 again here would continue,
  // so instead check Ctrl+Shift+F5 (no longer Run) leaves the session paused.
  await app.wd.keys([WebDriver.KEYS.CONTROL, SHIFT, F5]);
  await new Promise((r) => setTimeout(r, 500));
  assert.equal((await session()).status, "paused", "Ctrl+Shift+F5 does nothing");

  const input = await app.wd.find("//input[@placeholder='Add expression']");
  await app.wd.sendKeys(input, "number * 10" + WebDriver.KEYS.ENTER);
  const watched = await app.waitFor("watch evaluated", async () => {
    const value = await app.wd.execute(WATCH_VALUE, ["number * 10"]);
    return { done: !!value && value !== "…", value };
  }, 15_000);
  app.record("watch", { value: watched });
  assert.match(watched, /^\d+/, "Watch shows a number");

  // Hover "number" on line 21 with Monaco's Show Hover (Ctrl+K Ctrl+I) at the word.
  await goTo(`21:${HOVER_COLUMN}`);
  await app.wd.keys([WebDriver.KEYS.CONTROL, "k"], [WebDriver.KEYS.CONTROL, "i"]);
  const hover = await app.waitFor("hover shows a value", async () => {
    const text = await app.wd.execute(`const h = document.querySelector(".monaco-hover:not(.hidden)"); return h ? h.innerText : "";`);
    return { done: /number/.test(text) && /\d/.test(text), value: text };
  }, 10_000).catch(async (error) => { await app.screenshot("no-hover"); throw error; });
  app.record("hover", { text: hover });
  await app.screenshot("02-hover");

  await app.wd.keys(WebDriver.KEYS.ESCAPE);
  await app.wd.keys(F10);
  const stepped = await app.waitFor("F10 reaches the debugger", async () => {
    const value = { ...(await session()), watch: await app.wd.execute(WATCH_VALUE, ["number * 10"]) };
    // Two workers share the breakpoint, so a step can stop on line 21 again for the other
    // thread; any new stop (another line, or a step reason) shows F10 reached the debugger.
    return { done: value.status === "paused" && (value.where !== paused.where || value.reason !== paused.reason
      || (value.watch !== watched && value.watch !== "…")), value };
  }, 30_000).catch(async (error) => { await app.screenshot("03-not-stepped"); throw error; });
  app.record("stepped", stepped);
  await app.screenshot("03-stepped");

  await app.wd.keys([SHIFT, F5]);
  const stopped = await app.waitFor("Shift+F5 stops", async () => {
    const value = await session();
    return { done: !["paused", "running", "starting", "building"].includes(value.status), value };
  }, 30_000);
  app.record("stopped", stopped);
});
