#!/usr/bin/env python3
"""No-UI production-backend qualification. Use an empty output directory.

Fixtures exit through stdin; only the Rust harness's owned collector is faulted.
No system settings, capabilities or privileges are changed.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import subprocess
import time


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--harness', type=Path, required=True)
    p.add_argument('--build', type=Path, required=True)
    p.add_argument('--output', type=Path, required=True)
    p.add_argument('--cap-only', action='store_true')
    args = p.parse_args()
    args.output.mkdir(parents=True, exist_ok=False)
    solution = args.build / 'backend.cln'
    if not solution.exists():
        solution.write_text('[solution]\nname = "perf-backend-fixture"\n')
    fixture, library = args.build / 'fixture', args.build / 'libgenerated-no-fp.so'
    start = time.monotonic()
    if not args.cap_only:
        subprocess.run([str(args.harness), 'exercise', str(fixture), str(library),
                        str(solution), str(args.output / 'native')], check=True, timeout=120)
    with (args.output / 'cap-target.log').open('w') as log:
        target = subprocess.Popen([str(fixture), str(library), '32'], stdin=subprocess.PIPE,
                                  stdout=log, stderr=subprocess.STDOUT, text=True)
        try:
            deadline = time.monotonic() + 5
            while time.monotonic() < deadline:
                text = (args.output / 'cap-target.log').read_text()
                if text.count('THREAD busy-worker ') == 32 and 'READY' in text:
                    break
                time.sleep(.025)
            else:
                raise RuntimeError('32-worker target was not ready')
            run = subprocess.run([str(args.harness), 'capture', str(target.pid),
                                  str(args.output / 'cap'), '999', '3', '16384'],
                                 capture_output=True, text=True, timeout=120)
            (args.output / 'cap-harness.stderr').write_text(run.stderr)
            run.check_returncode()
            cap = json.loads(run.stdout)
            cap['targetSurvived'] = target.poll() is None
            (args.output / 'cap.json').write_text(json.dumps(cap, indent=2) + '\n')
        finally:
            if target.poll() is None:
                target.stdin.write('stop\n')
                target.stdin.flush()
            target.wait(timeout=10)
            target.stdin.close()
    provenance = {
        'machine': platform.node(), 'kernel': platform.release(), 'uid': os.geteuid(),
        'seconds': time.monotonic() - start, 'harnessSha256': hashlib.sha256(args.harness.read_bytes()).hexdigest(),
        'fixtureSha256': hashlib.sha256(fixture.read_bytes()).hexdigest(),
        'librarySha256': hashlib.sha256(library.read_bytes()).hexdigest(),
        'policy': {name: Path(path).read_text().strip() for name, path in {
            'perfEventParanoid': '/proc/sys/kernel/perf_event_paranoid',
            'kptrRestrict': '/proc/sys/kernel/kptr_restrict'}.items()},
        'desktopBehaviour': 'NOT TESTED', 'humanUsability': 'NOT TESTED',
    }
    (args.output / 'provenance.json').write_text(json.dumps(provenance, indent=2) + '\n')
    print(args.output)


if __name__ == '__main__':
    main()
