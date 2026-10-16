#!/usr/bin/env python3
"""Managed C# attach to a DISPOSABLE Unity Editor across two Play runs.

Copies workspaces/unity (without Library/Builds/Temp/Logs) into --scratch, starts a
batch-mode Editor there with session-only -debugCodeOptimization, and drives Play
enter/exit through control files read by an Editor script that exists only in the
copy. EditorPrefs are not changed. The adapter is used through its own Editor route
(Library/EditorInstance.json, port 56000 + PID % 1000), after the probe verifies that
port is owned by the Editor it started. The user's open Editor is only observed.
"""
import argparse, importlib.util, json, os, pathlib, shutil, signal, subprocess, time

HERE = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('player_probe', HERE / 'unity_managed_probe.py')
probe = importlib.util.module_from_spec(spec); spec.loader.exec_module(probe)
LINE = probe.LINE

DRIVER = r'''using System.IO;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
// Disposable-copy only. Polls control files so Play can be entered/exited repeatedly
// in one Editor process; re-registered after every domain reload by InitializeOnLoad.
[InitializeOnLoad]
public static class CraiddEditorDebugProof {
  static readonly string Folder = System.Environment.GetEnvironmentVariable("CRAIDD_EDITOR_DEBUG_PROOF");
  static double next;
  static CraiddEditorDebugProof() {
    if (string.IsNullOrEmpty(Folder)) return;
    EditorApplication.update += Tick;
    EditorApplication.playModeStateChanged += s => File.AppendAllText(Path.Combine(Folder, "events"), s + "\n");
  }
  public static void Run() {
    EditorSceneManager.OpenScene("Assets/Scenes/DebugProbe.unity");
    var pid = System.Diagnostics.Process.GetCurrentProcess().Id;
    // Record whether Unity wrote its discovery file; only fill a gap, marked as a substitute.
    var instance = "Library/EditorInstance.json";
    var unityWrote = File.Exists(instance);
    if (!unityWrote)
      File.WriteAllText(instance, "{\"process_id\":" + pid + ",\"version\":\"" + Application.unityVersion +
        "\",\"app_path\":\"" + EditorApplication.applicationPath + "\",\"app_contents_path\":\"" +
        EditorApplication.applicationContentsPath + "\",\"craidd_probe_substitute\":true}");
    Debug.Log("CRAIDD_EDITOR_DEBUG_PROOF cwd=" + Directory.GetCurrentDirectory() + " unityWroteInstance=" + unityWrote);
    File.WriteAllText(Path.Combine(Folder, "editor.ready"), pid.ToString());
  }
  static void Tick() {
    if (EditorApplication.timeSinceStartup < next) return;
    next = EditorApplication.timeSinceStartup + 0.2;
    var probe = Object.FindAnyObjectByType<NativeProbe>();
    File.WriteAllText(Path.Combine(Folder, "state"), (EditorApplication.isPlaying ? "playing" : "edit") + " " + (probe != null ? probe.result : 0));
    var command = Path.Combine(Folder, "command");
    if (!File.Exists(command)) return;
    var text = File.ReadAllText(command).Trim(); File.Delete(command);
    if (text == "play") EditorApplication.isPlaying = true;
    else if (text == "edit") EditorApplication.isPlaying = false;
    else if (text == "quit") EditorApplication.Exit(0);
  }
}
'''


def main():
    repo = HERE.parents[2]
    parser = argparse.ArgumentParser()
    parser.add_argument('--adapter', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--scratch', required=True, help='empty folder for the disposable project copy')
    parser.add_argument('--editor', default=str(pathlib.Path.home() / 'Unity/Hub/Editor/6000.5.10f1/Editor/Unity'))
    args = parser.parse_args()
    out = pathlib.Path(args.output).resolve(); out.mkdir(parents=True, exist_ok=True)
    scratch = pathlib.Path(args.scratch).resolve()
    project = scratch / 'unity'
    if project.exists():
        raise SystemExit(f'{project} exists; use an empty scratch folder')
    shutil.copytree(repo / 'workspaces/unity', project,
                    ignore=shutil.ignore_patterns('Library', 'Builds', 'Temp', 'Logs', 'obj', 'UserSettings', 'build'))
    (project / 'Assets/Editor/CraiddEditorDebugProof.cs').write_text(DRIVER)
    source = str(project / 'Assets/Scripts/NativeProbe.cs')
    control = out / 'control'; control.mkdir(exist_ok=True)
    for name in ('editor.ready', 'state', 'events', 'command'):
        (control / name).unlink(missing_ok=True)
    trace = (out / 'dap.jsonl').open('w')
    report = {'steps': []}
    adapter = ['dotnet', str(pathlib.Path(args.adapter).resolve())]

    def step(name, passed, **detail):
        report['steps'].append({'step': name, 'passed': bool(passed), **detail})
        print(('PASS ' if passed else 'FAIL ') + name, json.dumps(detail) if detail else '')
        if not passed:
            raise SystemExit(f'Qualification failed at {name}')

    def state():
        try:
            return (control / 'state').read_text().split()
        except FileNotFoundError:
            return []

    def command(text, expect=None, timeout=120):
        # With an armed breakpoint, the first Play Update can stop the Editor main thread before
        # EnteredPlayMode is delivered (observed in runs editor4/editor5). Do not wait on Editor
        # state then: the stopped event is the readiness signal.
        (control / 'command').write_text(text)
        if expect is None:
            return
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if state()[:1] == [expect]:
                return
            time.sleep(0.2)
        raise TimeoutError(f'Editor did not reach {expect}')

    foreign_before = probe.unity_processes(set())
    report['foreignBefore'] = foreign_before
    env = dict(os.environ, CRAIDD_EDITOR_DEBUG_PROOF=str(control))
    # Not `unity run`: that wrapper adds -quit, which ends the Editor once Run returns
    # (and Unity then deletes Library/EditorInstance.json). Observed in the first attempts.
    editor = subprocess.Popen([args.editor, '-batchmode', '-projectPath', str(project), '-nographics',
                               '-debugCodeOptimization', '-executeMethod', 'CraiddEditorDebugProof.Run',
                               '-logFile', str(out / 'editor.log')],
                              env=env, stdout=(out / 'unity-cli.out').open('w'), stderr=subprocess.STDOUT,
                              start_new_session=True)
    pid = None
    try:
        deadline = time.monotonic() + 600
        while not (control / 'editor.ready').exists():
            if editor.poll() is not None:
                raise RuntimeError('Editor exited before readiness; see editor.log')
            if time.monotonic() > deadline:
                raise TimeoutError('Editor readiness')
            time.sleep(0.5)
        pid = int((control / 'editor.ready').read_text()); birth = probe.stat(pid)['birth']
        port = 56000 + pid % 1000
        instance_path = project / 'Library/EditorInstance.json'
        for _ in range(50):
            if instance_path.exists():
                break
            time.sleep(0.2)
        instance = json.loads(instance_path.read_text()) if instance_path.exists() else {}
        step('disposable Editor endpoint owned by started PID', port in probe.listening_ports(pid)
             and instance.get('process_id') == pid, pid=pid, birth=birth, port=port,
             listening=probe.listening_ports(pid), editor_instance=instance)

        def attach(name):
            if port not in probe.listening_ports(pid) or not probe.alive(pid, birth):
                raise RuntimeError('Editor endpoint is no longer owned by the disposable Editor')
            dap = probe.Dap(adapter, trace, name)
            caps = dap.request('initialize', {'clientID': 'craidd-probe', 'adapterID': 'unity',
                                              'linesStartAt1': True, 'columnsStartAt1': True, 'pathFormat': 'path'})['body'] or {}
            dap.configuration_done = bool(caps.get('supportsConfigurationDoneRequest'))
            # processId 0: DotRush derives the port from EditorInstance.json, its documented Editor route.
            response = dap.request('attach', {'processId': 0, 'cwd': str(project)}, timeout=30, ok=False)
            return dap, response

        def breakpoints(dap, lines):
            return dap.request('setBreakpoints', {'source': {'path': source, 'name': 'NativeProbe.cs'},
                                                  'breakpoints': [{'line': l} for l in lines]})['body']['breakpoints']

        def hit(dap, name, timeout=90):
            stop = dap.event('stopped', timeout, lambda b: b.get('reason') == 'breakpoint')['body']
            frames = dap.request('stackTrace', {'threadId': stop['threadId'], 'levels': 20})['body']['stackFrames']
            scope = dap.request('scopes', {'frameId': frames[0]['id']})['body']['scopes'][0]
            values = {v['name']: v['value'] for v in dap.request('variables', {'variablesReference': scope['variablesReference']})['body']['variables']}
            step(f'{name}: C# breakpoint stack/locals in Play', frames[0].get('line') == LINE and 'input' in values,
                 thread=stop['threadId'], top=frames[0].get('name'), file=(frames[0].get('source') or {}).get('path'),
                 depth=len(frames), locals=values)
            return stop

        # E1: attach in Edit mode, enter Play, breakpoint, step, continue, detach while playing.
        dap, response = attach('e1')
        step('E1 attach in Edit mode accepted', response.get('success'), message=response.get('message'))
        dap.event('initialized', 30)
        report['e1Breakpoints'] = breakpoints(dap, [LINE])
        # Observed in run editor4: a breakpoint stop arrived in Edit mode before Play and froze
        # the Editor main thread. Record every pre-Play stop with its stack, then resume it.
        early = []
        try:
            while True:
                stop = dap.event('stopped', 5)['body']
                frames = dap.request('stackTrace', {'threadId': stop['threadId'], 'levels': 8})['body']['stackFrames']
                early.append({'stop': stop, 'state': state(), 'frames': [(f.get('name'), (f.get('source') or {}).get('path'), f.get('line')) for f in frames]})
                dap.request('continue', {'threadId': stop['threadId']})
        except TimeoutError:
            pass
        report['e1EditModeStops'] = early
        step('E1 no Edit-mode stop before Play', not early, stops=early)
        command('play')
        stop = hit(dap, 'E1')
        dap.request('next', {'threadId': stop['threadId']})
        stepped = dap.event('stopped', 30)['body']
        line = dap.request('stackTrace', {'threadId': stepped['threadId'], 'levels': 1})['body']['stackFrames'][0]['line']
        step('E1 step over', line == LINE + 1, line=line, reason=stepped.get('reason'))
        dap.request('continue', {'threadId': stepped['threadId']})
        hit(dap, 'E1 repeat')
        breakpoints(dap, [])
        dap.request('continue', {'threadId': stepped['threadId']})
        time.sleep(1)
        response = dap.request('disconnect', {'terminateDebuggee': False}, ok=False)
        code = dap.exited(15)
        before = state(); time.sleep(2); after = state()
        step('E1 detach while playing; Editor alive and still playing', response.get('success') and probe.alive(pid, birth)
             and after[:1] == ['playing'], adapter_exit=code, state_before=before, state_after=after)

        # E2: one attached session across Play exit (domain reload on next entry) and a second Play run.
        dap, response = attach('e2')
        step('E2 reattach during Play accepted', response.get('success'), message=response.get('message'))
        dap.event('initialized', 30)
        breakpoints(dap, [LINE])
        hit(dap, 'E2 first run')
        breakpoints(dap, [])
        dap.request('continue', {'threadId': 1}, ok=False)
        command('edit', 'edit')
        time.sleep(2)
        step('E2 session survives Play exit', dap.proc.poll() is None and probe.alive(pid, birth))
        report['e2RearmBreakpoints'] = breakpoints(dap, [LINE])
        command('play')
        try:
            hit(dap, 'E2 second Play run, same attached session')
            second_run = True
        except (TimeoutError, RuntimeError, SystemExit) as error:
            second_run = str(error)
        report['e2SecondRun'] = second_run
        if second_run is True:
            response = dap.request('disconnect', {'terminateDebuggee': False}, ok=False)
        else:
            response = {'success': None, 'message': 'second run not hit; adapter killed'}
            os.killpg(dap.proc.pid, signal.SIGKILL)
        dap.exited(15)
        time.sleep(2)
        step('E2 detach after second Play run; Editor alive', probe.alive(pid, birth), detach=response.get('success'),
             second_run=second_run, state=state())

        # E3: a fresh session in the second Play run, then Play exit while attached and detach in Edit mode.
        dap, response = attach('e3')
        step('E3 attach in second Play run accepted', response.get('success'), message=response.get('message'))
        dap.event('initialized', 30); breakpoints(dap, [LINE])
        hit(dap, 'E3')
        breakpoints(dap, []); dap.request('continue', {'threadId': 1}, ok=False)
        command('edit', 'edit')
        time.sleep(2)
        response = dap.request('disconnect', {'terminateDebuggee': False}, ok=False)
        code = dap.exited(15)
        step('E3 detach in Edit mode; Editor alive', response.get('success') and probe.alive(pid, birth), adapter_exit=code,
             state=state())
        (control / 'command').write_text('quit')
        editor.wait(120)
        step('disposable Editor quit on request', True, exit=editor.returncode)
    finally:
        if editor.poll() is None:
            if pid and probe.alive(pid, probe.stat(pid)['birth']):
                (control / 'command').write_text('quit')
            try:
                editor.wait(60)
            except subprocess.TimeoutExpired:
                os.killpg(editor.pid, signal.SIGTERM)
        foreign_after = probe.unity_processes({pid} if pid else set())
        survived = all(foreign_after.get(p, {}).get('birth') == v['birth'] for p, v in foreign_before.items())
        report['foreignSurvived'] = survived
        print(('PASS ' if survived else 'FAIL ') + 'foreign Unity processes unchanged', json.dumps(sorted(foreign_before)))
        (out / 'report.json').write_text(json.dumps(report, indent=2))
        trace.close()


if __name__ == '__main__':
    main()
