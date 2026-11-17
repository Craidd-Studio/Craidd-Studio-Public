// Native candidate smoke: real wizard controls, scaffolding and generated Rust build.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { launch } from './lib/harness.mjs';

const enabled = process.env.CRAIDD_TEST_PRERELEASE_WIZARD === '1';
test('native wizard reviews and creates a buildable Rust console without overwriting it', { skip: !enabled, timeout: 90000 }, async t => {
  const parent = await mkdtemp(join(tmpdir(), 'craidd-prerelease-wizard-'));
  const app = await launch('prerelease-wizard'); t.after(() => app.close());
  const click = async text => {
    const xpath = `//button[contains(normalize-space(.),${JSON.stringify(text)})]`;
    await app.waitFor(`button ready: ${text}`, async () => ({ done: await app.wd.execute('const e=document.evaluate(arguments[0],document,null,9,null).singleNodeValue;return !!e&&!e.disabled;', [xpath]) }));
    await app.wd.click(await app.wd.find(xpath));
  };
  await click('Create Project Wizard');
  await app.waitFor('wizard template step', async () => ({ done: await app.wd.execute('return document.querySelector("#project-wizard-title")?.textContent === "Create a project"') }));
  await click('Next');
  for (const [selector, value] of [['#project-wizard-form label input', 'CandidateRust'], ['#pw-parent', parent]]) {
    await app.wd.execute('const e=document.querySelector(arguments[0]);Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(e,arguments[1]);e.dispatchEvent(new Event("input",{bubbles:true}));', [selector, value]);
  }
  await click('Review project');
  await app.waitFor('native preview', async () => ({ done: await app.wd.execute('return document.querySelector("#project-wizard-title")?.textContent === "Ready to create"') }));
  assert.ok(await app.wd.execute('return document.body.innerText.includes("Cargo.toml")'));
  await app.screenshot('01-native-review');
  await click('Create project');
  await app.waitFor('created solution loaded', async () => ({ done: await app.wd.execute('return !document.querySelector("#project-wizard-title") && document.body.innerText.includes("CandidateRust")') }));
  const root = join(parent, 'CandidateRust');
  const source = await readFile(join(root, 'src/main.rs'), 'utf8');
  assert.match(source, /fn main/);
  const build = await promisify(execFile)('cargo', ['run', '--offline', '--manifest-path', join(root, 'Cargo.toml')], { cwd: root, timeout: 60000 });
  assert.ok(build.stdout.trim(), 'the generated program runs and produces output');
  assert.equal(await readFile(join(root, 'src/main.rs'), 'utf8'), source);
  await assert.rejects(app.invoke('preview_project_creation', { request: { templateId: 'rust-console', name: 'CandidateRust', parent, setupConfigs: true, dotnetFramework: 'net10.0', solutionPath: null } }), /empty|exists|exist/i);
  app.record('wizard-native-rust', { root, output: build.stdout.trim(), overwriteRefused: true });
  await app.screenshot('02-created-solution');
});
