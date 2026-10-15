#!/usr/bin/env python3
"""Exercise actual Unity C# -> C++ provider events, never a mocked Unity runtime."""
import argparse, collections, json, os, pathlib, socket, struct, subprocess, tempfile

def run(player, output):
    output.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='craidd-unity-probe-') as folder:
        path = str(pathlib.Path(folder) / 'events.sock')
        with socket.socket(socket.AF_UNIX) as server:
            server.bind(path); os.chmod(path, 0o600); server.listen(1); server.settimeout(15)
            env = dict(os.environ, CRAIDD_PROFILE_SOCKET=path)
            child = subprocess.Popen([str(player.resolve()), '-batchmode', '-nographics', '--craidd-smoke', '-logFile', str((output/'player.log').resolve())], env=env, stdout=subprocess.DEVNULL, start_new_session=True)
            events = []
            try:
                stream, _ = server.accept()
                with stream:
                    pid, uid, _ = struct.unpack('3i',stream.getsockopt(socket.SOL_SOCKET,socket.SO_PEERCRED,12))
                    assert pid == child.pid and uid == os.geteuid(), (pid,uid,child.pid)
                    stream.settimeout(15)
                    with stream.makefile('r') as reader:
                        for line in reader:
                            assert len(line) <= 4096
                            events.append(json.loads(line))
                assert child.wait(timeout=15) == 0
                (output/'events.jsonl').write_text(''.join(json.dumps(e)+'\n' for e in events))
                counts = collections.Counter(e['kind'] for e in events)
                assert counts['begin'] >= 30 and counts['end'] >= 30, counts
                assert counts['solo'] >= 30 and counts['play-end'] == 1, counts
                pending = {}; allocated = {}; allocated_total = freed_total = 0
                for e in events:
                    key=(e['marker'],e['thread'],e['invocation'])
                    if e['kind']=='begin': assert key not in pending; pending[key]=e
                    elif e['kind']=='end':
                        start=pending.pop(key); assert e['wallNs']>=start['wallNs'] and e['cpuNs']>=start['cpuNs']
                    elif e['kind']=='alloc': allocated[e['address']]=e['bytes']; allocated_total+=e['bytes']
                    elif e['kind']=='free': freed_total+=allocated.pop(e['address'])
                assert not pending and not allocated and allocated_total==freed_total and allocated_total>=8192
                assert 'CRAIDD_UNITY_PLAYER_SMOKE_OK' in (output/'player.log').read_text()
                print(f'PASS Unity player interop, authenticated PID {pid}, {dict(counts)}, native bytes allocated/freed {allocated_total}/{freed_total}, verified Play end')
            finally:
                if child.poll() is None: child.terminate(); child.wait(timeout=5)

if __name__=='__main__':
    parser=argparse.ArgumentParser(); parser.add_argument('--player',type=pathlib.Path,default=pathlib.Path('workspaces/unity/Builds/Linux/CraiddUnityProbe.x86_64')); parser.add_argument('--output',type=pathlib.Path,default=pathlib.Path('/tmp/craidd-unity-profile-proof'))
    args=parser.parse_args(); run(args.player,args.output)
