#!/usr/bin/env python3
"""Real LLDB-DAP attach/inspect/detach gate. Operates only on its disposable child."""
import argparse, pathlib, subprocess, sys, tempfile, time
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / 'ldi-gate-0/tools'))
from dap import Dap

def run(adapter, output, unity_player=None):
    fixture = pathlib.Path(__file__).resolve().parent
    output.mkdir(parents=True, exist_ok=True)
    if unity_player:
        binary = unity_player.resolve()
        source = pathlib.Path('workspaces/unity/Native/probe.cpp').resolve()
        target = subprocess.Popen([str(binary), '-batchmode', '-nographics', '--craidd-allow-attach', '-logFile', str((output/'target.log').resolve())], stdout=subprocess.DEVNULL, start_new_session=True)
    else:
        binary = output / 'attach-target'
        source = fixture / 'target.cpp'
        subprocess.run(['c++', '-g', '-O0', str(source), '-o', str(binary)], check=True)
        target = subprocess.Popen([str(binary)], stdout=(output / 'target.log').open('w'), start_new_session=True)
    dap = None
    try:
        if unity_player:
            deadline=time.monotonic()+15
            while not (output/'target.log').exists() or 'CRAIDD_UNITY_ATTACH_READY' not in (output/'target.log').read_text():
                assert time.monotonic()<deadline and target.poll() is None, 'Unity player did not become attach-ready'
                time.sleep(.05)
        else: time.sleep(.2)
        dap = Dap([adapter], output / 'dap.jsonl')
        dap.request('initialize', {'clientID': 'craidd-attach-gate', 'adapterID': 'lldb-dap',
            'pathFormat': 'path', 'linesStartAt1': True, 'columnsStartAt1': True})
        attach = dap.send('attach', {'pid': target.pid, 'program': str(binary),
            'initCommands': ['settings set symbols.enable-external-lookup false']})
        dap.event('initialized')
        line = next(i for i, s in enumerate(source.read_text().splitlines(), 1) if 'BREAK_HERE' in s)
        points = dap.request('setBreakpoints', {'source': {'path': str(source)}, 'breakpoints': [{'line': line}]})
        done = dap.send('configurationDone')
        dap.response(attach); dap.response(done)
        stopped = dap.event('stopped')
        thread = stopped['threadId']
        frame = dap.frame(thread)
        assert frame.get('source', {}).get('path', '').endswith(source.name), frame
        assert any(v['name'] == ('seed' if unity_player else 'value') for v in dap.variables(frame)), frame
        dap.request('disconnect', {'terminateDebuggee': False})
        def cpu_ticks(): return sum(map(int,pathlib.Path(f'/proc/{target.pid}/stat').read_text().rsplit(')',1)[1].split()[11:13]))
        before = cpu_ticks() if unity_player else (output / 'target.log').stat().st_size
        time.sleep(.3)
        assert target.poll() is None, 'Detach terminated foreign target'
        after = cpu_ticks() if unity_player else (output / 'target.log').stat().st_size
        assert after > before, 'Detach left foreign target stopped'
        print('PASS: attach, verified breakpoint, stack/locals, detach from pause; foreign target kept executing')
    finally:
        # Test-created target only. Dap.close defaults to terminateDebuggee:true; do not call it.
        if dap:
            if dap.process.poll() is None:
                try: dap.request('disconnect', {'terminateDebuggee': False})
                except Exception: pass
                try: dap.process.wait(timeout=2)
                except subprocess.TimeoutExpired: dap.process.terminate()
            dap.process.wait(timeout=5)
        target.terminate(); target.wait(timeout=5)

if __name__ == '__main__':
    parser = argparse.ArgumentParser(); parser.add_argument('--adapter', default='lldb-dap'); parser.add_argument('--output', type=pathlib.Path, required=True)
    parser.add_argument("--unity-player",type=pathlib.Path)
    args = parser.parse_args(); run(args.adapter, args.output,args.unity_player)
