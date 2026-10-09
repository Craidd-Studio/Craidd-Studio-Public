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
  async quit() { try { await this.command("DELETE", ""); } catch { /* Already gone. */ } }
}

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
