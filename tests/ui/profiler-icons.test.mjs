import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { APP, launch, openSolution } from "./lib/harness.mjs";

import { showProfiler, visibleIcons } from "./lib/profiler.mjs";
const ICONS = ["Take memory snapshot", "Snapshot and record again", "Stop profiling", "Profiling settings"];

test(`${process.env.CRAIDD_UI_APP ? "development" : "embedded"} Profiler SVG controls render with no file open and with Monaco open`, { timeout: 150000 }, async t => {
  const app = await launch("profiler-icons"); t.after(() => app.close());
  const root = await mkdtemp(join(tmpdir(), "craidd-icons-"));
  await writeFile(join(root,"Icons.cln"),'[solution]\nname="Profiler icon lab"\nversion="1.0"\nprojects=["Icons.craidd"]\n');
  await writeFile(join(root,"Icons.craidd"),'[project]\nname="Icons"\nlanguage="cpp"\nroot="."\n');
  await writeFile(join(root,"sample.cpp"),'int main() { return 42; }\n');
  await openSolution(app, join(root,"Icons.cln"));
  await showProfiler(app);
  app.record("build-target",{application:APP,url:await app.wd.execute("return location.href")});
  const check = async name => {
    const icons = await visibleIcons(app);
    for (const label of ICONS) {
      const icon=icons.find(i=>i.label===label);
      assert.ok(icon && icon.width>=14 && icon.height>=14 && icon.path && !icon.iconFont, `${name}: visible SVG for ${label}`);
      assert.notEqual(icon.stroke, "none");
    }
    app.record(name,{icons,viewport:await app.wd.execute("return {width:innerWidth,height:innerHeight,dpr:devicePixelRatio,csp:document.querySelector('meta[http-equiv=\"Content-Security-Policy\"]')?.content}")});
    await app.screenshot(name);
  };
  assert.equal(await app.wd.execute("return document.querySelectorAll('.monaco-editor').length"),0);
  await check("no-file-open");
  await app.wd.execute("window.__uiCsp=[];document.addEventListener('securitypolicyviolation',e=>window.__uiCsp.push({directive:e.violatedDirective,blocked:e.blockedURI}));");
  await app.wd.click(await app.wd.find("//*[@title='"+join(root,"sample.cpp")+"']"));
  await app.waitFor("Monaco open",async()=>({done:await app.wd.execute("return !!document.querySelector('.monaco-editor')")}));
  await check("editor-open");
  app.record("monaco-csp-unmodified",{violations:await app.wd.execute("return window.__uiCsp")});
});
