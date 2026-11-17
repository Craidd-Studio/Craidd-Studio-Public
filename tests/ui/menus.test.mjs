// Scenario 2: context menus stay inside the window (R3).
import { test } from "node:test";
import assert from "node:assert/strict";
import { launch, openLab } from "./lib/harness.mjs";

// Right-click a tree row by its label, at the given client point, and return the menu's box.
const OPEN_MENU = `
  const [section, text, corner] = arguments;
  const header = [...document.querySelectorAll("span, div")].find((el) => el.textContent.trim() === section);
  if (!header) return { error: "no section " + section };
  let scope = header.parentElement;
  while (scope && ![...scope.querySelectorAll("div")].some((el) => el.textContent.trim() === text)) scope = scope.parentElement;
  const row = scope && [...scope.querySelectorAll("div")].reverse().find((el) => el.textContent.trim() === text);
  if (!row) return { error: "no row " + text };
  const x = corner.includes("right") ? innerWidth - 3 : 3;
  const y = corner.includes("bottom") ? innerHeight - 3 : 3;
  row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 2 }));
  return { x, y };
`;
const MENU_BOX = `
  const menu = [...document.querySelectorAll(".fixed.z-50")].find((el) => el.textContent.includes("Copy Path"));
  if (!menu) return null;
  const r = menu.getBoundingClientRect();
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, vw: innerWidth, vh: innerHeight };
`;
const CLOSE = `document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); const b = document.querySelector(".fixed.inset-0.z-40"); if (b) b.click();`;

test("explorer menus stay inside a small window at every corner", { timeout: 180_000 }, async (t) => {
  const app = await launch("menus");
  t.after(() => app.close());
  await openLab(app, "mt-lab");
  await app.wd.command("POST", "/window/rect", { width: 900, height: 600 });

  for (const [section, row] of [["File Discovery", "README.md"], ["File Discovery", "CSharpConsole"]]) {
    for (const corner of ["bottom-right", "bottom-left", "top-right"]) {
      const opened = await app.wd.execute(OPEN_MENU, [section, row, corner]);
      assert.ok(!opened.error, opened.error);
      const box = await app.waitFor("menu placed", async () => {
        const value = await app.wd.execute(MENU_BOX);
        return { done: !!value, value };
      }, 5_000);
      // Let the ResizeObserver settle (Open in VS Code loads late), then measure again.
      await new Promise((r) => setTimeout(r, 300));
      const settled = await app.wd.execute(MENU_BOX);
      app.record(`${row}-${corner}`, { first: box, settled });
      await app.screenshot(`${row}-${corner}`);
      assert.ok(settled.left >= 0 && settled.top >= 0 && settled.right <= settled.vw && settled.bottom <= settled.vh,
        `${row} menu at ${corner} is inside the viewport: ${JSON.stringify(settled)}`);
      await app.wd.execute(CLOSE);
    }
  }
});
