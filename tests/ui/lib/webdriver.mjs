// A minimal W3C WebDriver client over fetch, for tauri-driver.
// See docs/uiux/design-ui-test-harness.md.

export class WebDriver {
  constructor(base, sessionId) { this.base = base; this.sessionId = sessionId; }

  static async connect(base, application, timeoutMs = 60_000) {
    const body = { capabilities: { alwaysMatch: { "tauri:options": { application }, browserName: "wry" } } };
    const value = await request(base, "POST", "/session", body, timeoutMs);
    return new WebDriver(base, value.sessionId);
  }

  command(method, path, body) {
    return request(this.base, method, `/session/${this.sessionId}${path}`, body);
  }

  /** Run `script` in the page; it receives `args` and must call the last argument with its result. */
  executeAsync(script, args = []) {
    return this.command("POST", "/execute/async", { script, args });
  }

  execute(script, args = []) { return this.command("POST", "/execute/sync", { script, args }); }
  windowHandles() { return this.command("GET", "/window/handles"); }
  switchTo(handle) { return this.command("POST", "/window", { handle }); }
  title() { return this.command("GET", "/title"); }
  screenshot() { return this.command("GET", "/screenshot"); }
  static ELEMENT = "element-6066-11e4-a52e-4f735466cecf";

  async find(xpath) {
    const value = await this.command("POST", "/element", { using: "xpath", value: xpath });
    return value[WebDriver.ELEMENT];
  }
  click(element) { return this.command("POST", `/element/${element}/click`, {}); }
  sendKeys(element, text) { return this.command("POST", `/element/${element}/value`, { text }); }

  /** Press keys through the focused element. Use WebDriver.KEYS for F-keys and modifiers. */
  keys(...sequence) {
    const actions = [];
    for (const item of sequence) {
      const chord = Array.isArray(item) ? item : [item];
      for (const key of chord) actions.push({ type: "keyDown", value: key });
      for (const key of [...chord].reverse()) actions.push({ type: "keyUp", value: key });
    }
    return this.command("POST", "/actions", { actions: [{ type: "key", id: "keyboard", actions }] });
  }

  /** A real pointer click at the element's centre (Monaco ignores synthetic element clicks). */
  pointerClick(element, x = 0, y = 0) {
    return this.command("POST", "/actions", { actions: [{ type: "pointer", id: "mouse", parameters: { pointerType: "mouse" },
      actions: [{ type: "pointerMove", duration: 50, origin: { [WebDriver.ELEMENT]: element }, x, y },
        { type: "pointerDown", button: 0 }, { type: "pointerUp", button: 0 }] }] });
  }

  /** Pointer actions at viewport coordinates; `click` adds a left click. */
  pointerAt(x, y, click = false) {
    const actions = [{ type: "pointerMove", duration: 50, origin: "viewport", x: Math.round(x), y: Math.round(y) }];
    if (click) actions.push({ type: "pointerDown", button: 0 }, { type: "pointerUp", button: 0 });
    return this.command("POST", "/actions", { actions: [{ type: "pointer", id: "mouse", parameters: { pointerType: "mouse" }, actions }] });
  }

  /** Centre of the first element matching an XPath, from the page's own layout. */
  async centreOf(xpath) {
    const box = await this.execute(`const el = document.evaluate(arguments[0], document, null, 9, null).singleNodeValue;
      if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + Math.min(r.width / 2, 12), y: r.top + r.height / 2 };`, [xpath]);
    if (!box) throw new Error(`No element for ${xpath}`);
    return box;
  }

  moveTo(element, x = 0, y = 0) {
    return this.command("POST", "/actions", { actions: [{ type: "pointer", id: "mouse", parameters: { pointerType: "mouse" },
      actions: [{ type: "pointerMove", duration: 50, origin: { [WebDriver.ELEMENT]: element }, x, y }] }] });
  }

  async quit() { try { await this.command("DELETE", ""); } catch { /* Already gone. */ } }
}

WebDriver.KEYS = { SHIFT: "\uE008", CONTROL: "\uE009", ENTER: "\uE007", ESCAPE: "\uE00C",
  F5: "\uE035", F6: "\uE036", F9: "\uE039", F10: "\uE03A", F11: "\uE03B" };

async function request(base, method, path, body, timeoutMs = 30_000) {
  const response = await fetch(base + path, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok || json.value?.error) {
    throw new Error(`${method} ${path}: ${json.value?.error ?? response.status} ${json.value?.message ?? ""}`.trim());
  }
  return json.value;
}
