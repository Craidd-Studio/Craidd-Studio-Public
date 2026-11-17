#!/usr/bin/env python3
"""Run one owned qualification command and retain Linux wait4 high-water usage.

ru_maxrss is the largest waited-for process, not a summed process-tree peak.
No process signals, environment policy changes or external dependencies.
"""
import argparse
import json
import os
from pathlib import Path
import time

p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--output',type=Path,required=True)
p.add_argument('command',nargs=argparse.REMAINDER)
a=p.parse_args()
if not a.command or a.output.exists():p.error('command required and output must not exist')
start=time.monotonic()
pid=os.fork()
if pid==0:
    try:os.execvpe(a.command[0],a.command,os.environ.copy())
    except OSError:os._exit(127)
_,status,usage=os.wait4(pid,0)
result={'command':a.command,'exitCode':os.waitstatus_to_exitcode(status),'wallSeconds':time.monotonic()-start,
        'maxRssKiB':usage.ru_maxrss,'userSeconds':usage.ru_utime,'systemSeconds':usage.ru_stime,
        'scope':'Linux wait4: largest waited-for process including propagated descendants, not simultaneous/summed tree RSS; includes monitor and target, excludes earlier compiler build'}
a.output.write_text(json.dumps(result,indent=2)+'\n')
print(a.output)
raise SystemExit(result['exitCode'])
