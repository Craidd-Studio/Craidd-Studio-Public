#!/usr/bin/env python3
"""Direct DAP qualification of a Unity-compatible managed C# adapter.

Launches its OWN disposable development player (Mono backend, Script Debugging),
discovers that PID's managed-debugger port from /proc, then drives an external
DAP adapter (DotRush monodbg) over stdio. It never connects to a port that is
not owned by the player it started. Other Unity processes are only observed.

This is a protocol proof against a real runtime. It does not exercise Craidd.
"""
import argparse, json, os, pathlib, queue, re, signal, subprocess, threading, time

LINE = 41  # Assets/Scripts/NativeProbe.cs: MANAGED_BREAK_HERE


def stat(pid):
    fields = pathlib.Path(f'/proc/{pid}/stat').read_text().rsplit(')', 1)[1].split()
    return {'state': fields[0], 'birth': int(fields[19]), 'cpu': int(fields[11]) + int(fields[12])}


def alive(pid, birth):
    try:
        s = stat(pid)
        return s['birth'] == birth and s['state'] != 'Z'
    except (FileNotFoundError, ProcessLookupError):
        return False


def unity_processes(exclude):
    found = {}
    for entry in pathlib.Path('/proc').iterdir():
        if not entry.name.isdigit() or int(entry.name) in exclude:
            continue
        try:
            exe = os.readlink(entry / 'exe')
        except OSError:
            continue
        if 'unity' in pathlib.Path(exe).name.lower():
            found[int(entry.name)] = {'exe': exe, 'birth': stat(int(entry.name))['birth']}
    return found


def listening_ports(pid):
    """TCP LISTEN ports whose socket inode belongs to this PID's descriptors."""
    inodes = set()
    for fd in pathlib.Path(f'/proc/{pid}/fd').iterdir():
        try:
            target = os.readlink(fd)
        except OSError:
            continue
        m = re.fullmatch(r'socket:\[(\d+)\]', target)
        if m:
            inodes.add(m.group(1))
    ports = set()
    for table in ('tcp', 'tcp6'):
        for row in pathlib.Path(f'/proc/{pid}/net/{table}').read_text().splitlines()[1:]:
            cols = row.split()
            if cols[3] == '0A' and cols[9] in inodes:  # 0A = LISTEN
                ports.add(int(cols[1].rsplit(':', 1)[1], 16))
    return sorted(ports)


class Dap:
    def __init__(self, command, trace, name):
        self.name, self.trace, self.seq = name, trace, 0
        self.proc = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                     stderr=subprocess.DEVNULL, start_new_session=True)
        self.messages, self.seen = queue.Queue(), []
        threading.Thread(target=self._read, daemon=True).start()

    def log(self, direction, message):
        self.trace.write(json.dumps({'t': round(time.time(), 3), 'session': self.name,
                                     'dir': direction, 'msg': message}) + '\n')
        self.trace.flush()

    def _read(self):
        stream = self.proc.stdout
        while True:
            header = b''
            while not header.endswith(b'\r\n\r\n'):
                byte = stream.read(1)
                if not byte:
                    self.messages.put(None)
                    return
                header += byte
            length = int(re.search(rb'Content-Length: *(\d+)', header).group(1))
            message = json.loads(stream.read(length))
            self.log('in', message)
            self.messages.put(message)

    def send(self, command, arguments=None):
        self.seq += 1
        message = {'seq': self.seq, 'type': 'request', 'command': command, 'arguments': arguments or {}}
        self.log('out', message)
        body = json.dumps(message).encode()
        self.proc.stdin.write(b'Content-Length: %d\r\n\r\n' % len(body) + body)
        self.proc.stdin.flush()
        return self.seq

    def wait(self, predicate, timeout, what):
        deadline = time.monotonic() + timeout
        for message in self.seen:
            if predicate(message):
                self.seen.remove(message)
                return message
        while time.monotonic() < deadline:
            try:
                message = self.messages.get(timeout=max(0.05, deadline - time.monotonic()))
            except queue.Empty:
                break
            if message is None:
                raise RuntimeError(f'{self.name}: adapter output closed while waiting for {what}')
            if predicate(message):
                return message
            self.seen.append(message)
        raise TimeoutError(f'{self.name}: {what}')

    def request(self, command, arguments=None, timeout=20, ok=True):
        seq = self.send(command, arguments)
        response = self.wait(lambda m: m.get('type') == 'response' and m.get('request_seq') == seq,
                             timeout, f'{command} response')
        if ok and not response.get('success'):
            raise RuntimeError(f'{self.name}: {command} failed: {response.get("message")}')
        return response

    def event(self, name, timeout=30, where=lambda body: True):
        return self.wait(lambda m: m.get('type') == 'event' and m.get('event') == name
                         and where(m.get('body') or {}), timeout, f'{name} event')

    def exited(self, timeout):
        try:
            return self.proc.wait(timeout)
        except subprocess.TimeoutExpired:
            return None


def main():
    repo = pathlib.Path(__file__).resolve().parents[3]
    parser = argparse.ArgumentParser()
    parser.add_argument('--adapter', required=True, help='path to monodbg.dll')
    parser.add_argument('--player', default=str(repo / 'workspaces/unity/Builds/Linux/CraiddUnityProbe.x86_64'))
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    out = pathlib.Path(args.output).resolve(); out.mkdir(parents=True, exist_ok=True)
    source = str((repo / 'workspaces/unity/Assets/Scripts/NativeProbe.cs').resolve())
    player = pathlib.Path(args.player).resolve()
    managed = player.parent / (player.stem + '_Data') / 'Managed' / 'Assembly-CSharp.dll'
    adapter = ['dotnet', str(pathlib.Path(args.adapter).resolve())]
    report, trace = {'steps': []}, (out / 'dap.jsonl').open('w')

    def step(name, passed, **detail):
        report['steps'].append({'step': name, 'passed': bool(passed), **detail})
        print(('PASS ' if passed else 'FAIL ') + name, json.dumps(detail) if detail else '')
        if not passed:
            raise SystemExit(f'Qualification failed at {name}')

    owned, target = [], {}

    def start_player(name):
        log_path = out / f'{name}.log'
        child = subprocess.Popen([str(player), '-batchmode', '-nographics', '-logFile', str(log_path)],
                                 cwd=player.parent, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                 start_new_session=True)
        owned.append(child)
        port, deadline = None, time.monotonic() + 60
        while time.monotonic() < deadline and port is None:
            time.sleep(0.25)
            log = log_path.read_text(errors='replace') if log_path.exists() else ''
            m = re.search(r'Starting managed debugger on port (\d+)', log)
            if m and int(m.group(1)) in listening_ports(child.pid):
                port = int(m.group(1))
        target.update(child=child, pid=child.pid, birth=stat(child.pid)['birth'], port=port)
        # Only ever connect to a port this exact PID is listening on.
        step(f'{name} endpoint owned by started PID', port, pid=child.pid, birth=target['birth'], port=port,
             listening=listening_ports(child.pid))

    foreign_before = unity_processes(set())
    report['foreignBefore'] = foreign_before
    try:
        start_player('player')
        child, pid, birth = target['child'], target['pid'], target['birth']

        def frame_values(dap, thread_id):
            frames = dap.request('stackTrace', {'threadId': thread_id, 'levels': 20})['body']['stackFrames']
            top = frames[0]
            scopes = dap.request('scopes', {'frameId': top['id']})['body']['scopes']
            values = {}
            for scope in scopes:
                for var in dap.request('variables', {'variablesReference': scope['variablesReference']})['body']['variables']:
                    values[var['name']] = var
            fields = {}
            if 'this' in values and values['this'].get('variablesReference'):
                for var in dap.request('variables', {'variablesReference': values['this']['variablesReference']})['body']['variables']:
                    fields[var['name']] = var.get('value')
            return frames, scopes, {k: v.get('value') for k, v in values.items()}, fields

        def attach(name, shim=True):
            dap = Dap(adapter, trace, name)
            caps = dap.request('initialize', {'clientID': 'craidd-probe', 'adapterID': 'unity', 'linesStartAt1': True,
                                              'columnsStartAt1': True, 'pathFormat': 'path'})['body'] or {}
            # DAP: configurationDone only when advertised. DotRush 2026.10 does not advertise it and
            # treats an unsolicited request as fatal (observed in run 1; see the qualification record).
            dap.configuration_done = bool(caps.get('supportsConfigurationDoneRequest'))
            report.setdefault('capabilities', caps)
            if shim:
                # DotRush 2026.10 always reads <cwd>/Library/EditorInstance.json and treats
                # processId as the TCP port. A private shim satisfies that for a player.
                cwd = out / f'shim-{name}'; (cwd / 'Library').mkdir(parents=True, exist_ok=True)
                (cwd / 'Library/EditorInstance.json').write_text(json.dumps(
                    {'process_id': target['pid'], 'version': '6000.5.10f1', 'app_path': str(player), 'app_contents_path': str(player.parent)}))
                if target['port'] not in listening_ports(target['pid']):
                    raise RuntimeError('Debugger port is no longer owned by the selected player')
                arguments = {'processId': target['port'], 'cwd': str(cwd), 'userAssemblies': [str(managed)]}
            else:
                arguments = {'processId': target['pid'], 'cwd': str(player.parent), 'userAssemblies': [str(managed)]}
            return dap, dap.request('attach', arguments, timeout=30, ok=False)

        def configure(dap):
            if dap.configuration_done:
                dap.request('configurationDone')

        def set_breakpoint(dap, lines):
            body = dap.request('setBreakpoints', {'source': {'path': source, 'name': 'NativeProbe.cs'},
                                                  'breakpoints': [{'line': l} for l in lines]})['body']
            return body['breakpoints']

        def hit(dap, name, timeout=30):
            stop = dap.event('stopped', timeout, lambda b: b.get('reason') == 'breakpoint')['body']
            frames, scopes, locals_, fields = frame_values(dap, stop['threadId'])
            top = frames[0]
            step(f'{name}: C# breakpoint stack/locals', top.get('line') == LINE and 'input' in locals_ and 'count' in locals_,
                 thread=stop['threadId'], top=top.get('name'), line=top.get('line'), file=(top.get('source') or {}).get('path'),
                 depth=len(frames), scopes=[s['name'] for s in scopes], locals=locals_,
                 seed_field=fields.get('seed'))
            # frames is private (DotRush groups it under Non-public members); input = seed + frames.
            return stop, int(locals_['input']) - int(fields['seed'])

        # S0: the adapter's documented route needs an Editor-written EditorInstance.json.
        dap, response = attach('s0-unshimmed', shim=False)
        step('S0 unshimmed player attach is rejected by adapter (observed limitation)', not response.get('success'),
             message=response.get('message'))
        dap.proc.kill(); dap.exited(5)
        step('S0 player unaffected', alive(pid, birth))

        # S1: attach, breakpoint, stack/locals, step, continue, clear, detach while running.
        dap, response = attach('s1')
        step('S1 attach accepted', response.get('success'), message=response.get('message'))
        dap.event('initialized', 30)
        bps = set_breakpoint(dap, [LINE])
        configure(dap)
        stop, frames1 = hit(dap, 'S1')
        report['s1Breakpoints'] = bps
        threads = dap.request('threads')['body']['threads']
        step('S1 threads listed', any(t['id'] == stop['threadId'] for t in threads), count=len(threads))
        dap.request('next', {'threadId': stop['threadId']})
        # Observed: DotRush reports step completion as reason "pause", not "step".
        stepped = dap.event('stopped', 30)['body']
        line = dap.request('stackTrace', {'threadId': stepped['threadId'], 'levels': 1})['body']['stackFrames'][0]['line']
        step('S1 step over moves to next C# line', line == LINE + 1, line=line, reason=stepped.get('reason'))
        dap.request('continue', {'threadId': stepped['threadId']})
        _, frames1b = hit(dap, 'S1 repeat')
        step('S1 continue reaches next Update', frames1b is not None and frames1 is not None and frames1b > frames1,
             before=frames1, after=frames1b)
        set_breakpoint(dap, [])
        dap.request('continue', {'threadId': stop['threadId']})
        time.sleep(1)
        response = dap.request('disconnect', {'terminateDebuggee': False}, ok=False)
        step('S1 disconnect(terminateDebuggee:false) acknowledged', response.get('success'), message=response.get('message'))
        code = dap.exited(15)
        step('S1 adapter exits after detach; player alive', alive(pid, birth), adapter_exit=code)

        # S2: reattach (reattachment) and detach from a paused breakpoint with breakpoints still set.
        time.sleep(1)
        dap, response = attach('s2')
        step('S2 reattach accepted', response.get('success'), message=response.get('message'))
        dap.event('initialized', 30); set_breakpoint(dap, [LINE]); configure(dap)
        _, frames2 = hit(dap, 'S2')
        step('S2 target ran between sessions', frames2 > frames1b, before=frames1b, after=frames2)
        response = dap.request('disconnect', {'terminateDebuggee': False}, ok=False)
        step('S2 detach while paused acknowledged', response.get('success'), message=response.get('message'))
        dap.exited(15)
        cpu = stat(pid)['cpu']; time.sleep(2)
        step('S2 player alive after paused detach', alive(pid, birth), cpu_ticks_delta=stat(pid)['cpu'] - cpu)

        # S3: confirm S2's paused detach resumed and dropped its breakpoint, then kill the adapter while paused.
        time.sleep(1)
        dap, response = attach('s3')
        step('S3 attach accepted', response.get('success'), message=response.get('message'))
        dap.event('initialized', 30); set_breakpoint(dap, [LINE]); configure(dap)
        _, frames3 = hit(dap, 'S3')
        step('S3 paused detach had resumed Update', frames3 > frames2, before=frames2, after=frames3)
        os.killpg(dap.proc.pid, signal.SIGKILL); dap.exited(5)
        time.sleep(3)
        step('S3 player alive after adapter SIGKILL while paused', alive(pid, birth))

        # S4: after adapter failure the agent accepts a new debugger and the target had resumed.
        dap, response = attach('s4')
        step('S4 attach after adapter failure accepted', response.get('success'), message=response.get('message'))
        dap.event('initialized', 30); set_breakpoint(dap, [LINE]); configure(dap)
        _, frames4 = hit(dap, 'S4')
        step('S4 target resumed after adapter failure', frames4 > frames3, before=frames3, after=frames4)
        set_breakpoint(dap, []); dap.request('continue', {'threadId': 0}, ok=False)
        # S5: the owned disposable player ends while attached (application end / Stop of the target).
        time.sleep(1)
        child.send_signal(signal.SIGTERM)
        try:
            terminated = dap.event('terminated', 30)
        except (TimeoutError, RuntimeError) as error:
            terminated = {'error': str(error)}
        child.wait(30)
        code = dap.exited(5)
        step('S5 owned player end observed by adapter', 'error' not in terminated, event=terminated, adapter_exit=code,
             player_exit=child.returncode)
        # Craidd's attached teardown sends disconnect(false) after terminated; record the adapter's answer.
        if code is None:
            response = dap.request('disconnect', {'terminateDebuggee': False}, timeout=10, ok=False)
            code = dap.exited(10)
            step('S5 disconnect after target end', code is not None, success=response.get('success'),
                 message=response.get('message'), adapter_exit=code)

        # S6: a new player incarnation (the standalone analogue of a fresh Play run) gets a new endpoint.
        old = (pid, birth, target['port'])
        start_player('player2')
        dap, response = attach('s6')
        step('S6 attach to new incarnation accepted', response.get('success'), previous=old,
             current=(target['pid'], target['birth'], target['port']))
        dap.event('initialized', 30); set_breakpoint(dap, [LINE]); configure(dap)
        hit(dap, 'S6')
        set_breakpoint(dap, [])
        response = dap.request('disconnect', {'terminateDebuggee': False}, ok=False)
        code = dap.exited(15)
        time.sleep(1)
        step('S6 detach leaves new incarnation alive', response.get('success') and alive(target['pid'], target['birth']),
             adapter_exit=code)
    finally:
        for owned_child in owned:
            if owned_child.poll() is None:
                owned_child.send_signal(signal.SIGTERM)
                try:
                    owned_child.wait(20)
                except subprocess.TimeoutExpired:
                    owned_child.kill()
        foreign_after = unity_processes({c.pid for c in owned})
        survivors = {p: v for p, v in foreign_before.items() if foreign_after.get(p, {}).get('birth') == v['birth']}
        report['foreignAfter'] = foreign_after
        report['foreignSurvived'] = len(survivors) == len(foreign_before)
        print(('PASS ' if report['foreignSurvived'] else 'FAIL ') + 'foreign Unity processes unchanged',
              json.dumps(sorted(foreign_before)))
        (out / 'report.json').write_text(json.dumps(report, indent=2))
        trace.close()


if __name__ == '__main__':
    main()
