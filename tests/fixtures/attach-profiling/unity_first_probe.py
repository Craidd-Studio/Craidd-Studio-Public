#!/usr/bin/env python3
"""Actual Editor starts first, then discovers/reconnects to a selected profiling owner.
Uses a disposable project copy; never closes or rebuilds a user's open Editor.
The socket host implements the same published rendezvous contract as the Rust tests.
"""
import argparse, json, os, pathlib, shutil, socket, struct, subprocess, tempfile, time, uuid


def birth(pid):
    return int(pathlib.Path(f'/proc/{pid}/stat').read_text().rsplit(')', 1)[1].split()[19])


def run(output):
    repo = pathlib.Path(__file__).resolve().parents[3]
    output = output.resolve(); output.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='craidd-unity-first-') as temp:
        root = pathlib.Path(temp); project = root / 'workspaces/unity'
        shutil.copytree(repo / 'workspaces/unity', project, ignore=shutil.ignore_patterns('Library', 'Temp', 'Logs', 'Builds', 'obj', 'UserSettings', 'build'))
        shutil.copytree(repo / 'src-tauri/native/profiling', root / 'src-tauri/native/profiling')
        subprocess.run(['cmake', '-S', str(project / 'Native'), '-B', str(project / 'Native/build'), '-DCMAKE_BUILD_TYPE=Debug'], check=True)
        subprocess.run(['cmake', '--build', str(project / 'Native/build')], check=True)
        (project / 'Assets/Editor/UnityFirstSmoke.cs').write_text('''using System;
using System.IO;
using System.Threading;
using UnityEngine;
public static class UnityFirstSmoke {
 public static void Run() {
  string folder=Environment.GetEnvironmentVariable("CRAIDD_UNITY_FIRST_PROOF");
  if(!String.IsNullOrEmpty(Environment.GetEnvironmentVariable("CRAIDD_PROFILE_SOCKET"))) throw new Exception("Launch socket must be absent");
  NativeProbe.craidd_probe_mix(7,200);
  File.WriteAllText(Path.Combine(folder,"editor.ready"),System.Diagnostics.Process.GetCurrentProcess().Id.ToString());
  var until=DateTime.UtcNow.AddSeconds(90); int i=0;
  while(!File.Exists(Path.Combine(folder,"stop")) && DateTime.UtcNow<until) {
   NativeProbe.craidd_probe_mix(7,200);
   if(++i%10==0) NativeProbe.craidd_probe_allocate(128,0);
   Thread.Sleep(20);
  }
  if(!File.Exists(Path.Combine(folder,"stop"))) throw new Exception("Late host timed out");
  NativeProbe.craidd_probe_play_end(); Debug.Log("CRAIDD_UNITY_FIRST_DISCOVERY_OK");
 }
}''')
        for name in ['editor.ready', 'stop']:
            (output / name).unlink(missing_ok=True)
        env = dict(os.environ, CRAIDD_UNITY_FIRST_PROOF=str(output), CRAIDD_PROFILE_NAMESPACE='unity-first-' + uuid.uuid4().hex); env.pop('CRAIDD_PROFILE_SOCKET', None)
        log = output / 'unity.log'
        child = subprocess.Popen(['unity', 'run', str(project), '--timeout', '300', '--', '-nographics', '-executeMethod', 'UnityFirstSmoke.Run'], env=env, stdout=log.open('w'), stderr=subprocess.STDOUT)
        route = None; body = None
        try:
            deadline = time.monotonic() + 240
            while not (output / 'editor.ready').exists():
                if child.poll() is not None: raise RuntimeError('Unity failed before readiness; see ' + str(log))
                if time.monotonic() >= deadline: raise TimeoutError('Editor readiness; see ' + str(log))
                time.sleep(.1)
            pid = int((output / 'editor.ready').read_text()); incarnation = birth(pid)
            base = pathlib.Path(env.get('XDG_RUNTIME_DIR', str(pathlib.Path(env['HOME']) / '.cache/craidd-studio')))
            base.mkdir(mode=0o700, parents=True, exist_ok=True)
            parent = base / 'craidd-profiling'; parent.mkdir(mode=0o700, exist_ok=True)
            value = 0xcbf29ce484222325
            for byte in env['CRAIDD_PROFILE_NAMESPACE'].encode(): value = ((value ^ byte) * 0x100000001b3) & ((1 << 64) - 1)
            runtime = parent / f'n{value:016x}'; runtime.mkdir(mode=0o700, exist_ok=True)
            assert runtime.stat().st_uid == os.geteuid() and runtime.stat().st_mode & 0o077 == 0
            route = runtime / f'{pid}-{incarnation}.endpoint'
            events = []
            for pass_index in [1, 2]:
                path = root / f'events-{pass_index}.sock'
                with socket.socket(socket.AF_UNIX) as server:
                    server.bind(str(path)); server.listen(1); server.settimeout(8)
                    body = f'CRAIDD_PROFILE_V1\n{path}\n{os.getpid()}\n{birth(os.getpid())}\nunity-first-{pass_index}\n'
                    fd = os.open(route, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
                    with os.fdopen(fd, 'w') as file: file.write(body)
                    stream, _ = server.accept()
                    with stream:
                        peer_pid, peer_uid, _ = struct.unpack('3i', stream.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12))
                        assert (peer_pid, peer_uid) == (pid, os.geteuid()) and birth(pid) == incarnation
                        stream.settimeout(5)
                        with stream.makefile('r') as reader:
                            received = [json.loads(reader.readline()) for _ in range(80)]
                            assert any(e['kind'] == 'solo' for e in received)
                            assert any(e['kind'] == 'begin' for e in received)
                            events.extend(received)
                            route.unlink()
                            # Stop must revoke the discovered route without ending Unity.
                            for line in reader:
                                if len(line) > 4096: raise RuntimeError('Oversized provider event')
                        assert birth(pid) == incarnation
            (output / 'events.jsonl').write_text(''.join(json.dumps(e)+'\n' for e in events))
            (output / 'stop').touch()
            assert child.wait(timeout=30) == 0, log.read_text()[-6000:]
            assert 'CRAIDD_UNITY_FIRST_DISCOVERY_OK' in log.read_text()
            print(f'PASS actual Unity Editor PID {pid}: launch without socket env, late connection, Stop revocation, reconnect without Editor restart')
        finally:
            if route and route.exists() and route.read_text() == body: route.unlink()
            (output / 'stop').touch()
            if child.poll() is None:
                try: child.wait(timeout=15)
                except subprocess.TimeoutExpired: child.terminate(); child.wait(timeout=15)

if __name__ == '__main__':
    parser = argparse.ArgumentParser(); parser.add_argument('--output', type=pathlib.Path, default=pathlib.Path('/tmp/craidd-unity-first-proof'))
    run(parser.parse_args().output)
