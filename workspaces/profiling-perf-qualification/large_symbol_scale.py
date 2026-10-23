#!/usr/bin/env python3
"""Generate and qualify one 200,000-function ELF library; normal-user tools only.

Build is sharded to bound compiler memory. Measurements use the production
backend with existing perf decoding. No policy/capability changes or target signals.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
import os
from pathlib import Path
import platform
import select
import subprocess
import sys
import threading
import time

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / 'profiling-perf-backend'))
from qualify_remaining import Server

FUNCTIONS = 200000
SHARD = 5000
CHAINS = 20


def fingerprint(path):
    path = Path(path)
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024*1024), b''):
            h.update(chunk)
    return {'path': str(path), 'bytes': path.stat().st_size, 'sha256': h.hexdigest()}


def command(args, timeout=180):
    started = time.monotonic()
    result = subprocess.run([str(v) for v in args], capture_output=True, text=True, timeout=timeout,
                            env={**os.environ, 'LC_ALL':'C', 'DEBUGINFOD_URLS':''})
    record = {'argv': [str(v) for v in args], 'wallMs': (time.monotonic()-started)*1000,
              'exitCode':result.returncode, 'stdout':result.stdout[-4000:], 'stderr':result.stderr[-8000:]}
    if result.returncode:
        raise RuntimeError(json.dumps(record))
    return record


def build(folder):
    folder.mkdir(parents=True, exist_ok=False)
    source = folder / 'sources'
    source.mkdir()
    header = '#include <cstdint>\n#define NODE extern "C" __attribute__((noinline,noipa)) std::uint64_t\n'
    shards = []
    for start in range(0, FUNCTIONS-1, SHARD):
        lines = [header]
        for index in range(start, min(start+SHARD, FUNCTIONS-1)):
            chain, layer = divmod(index,10000)
            name = f'scale_fn_{index:06}'
            if chain < CHAINS and layer < 4:
                if layer == 0:
                    body = f'volatile std::uint64_t frame[2]={{n,n+1}}; n=frame[0]; for(unsigned i=0;i<100000;++i){{n^=n<<13;n^=n>>7;n^=n<<17;n+={index+1};}} frame[1]=n;return frame[1];'
                else:
                    body = f'volatile std::uint64_t v=scale_fn_{index-1:06}(n); return v+{index+1};'
            else:
                body = f'return (n ^ {index+1}ULL) * {2*index+3}ULL;'
            lines.append(f'NODE {name}(std::uint64_t n){{{body}}}\n')
        path = source / f'shard_{start//SHARD:02}.cpp'
        path.write_text(''.join(lines)); shards.append(path)
    entry = source / 'entry.cpp'
    lines = [header]
    for chain in range(CHAINS):
        lines.append(f'extern "C" std::uint64_t scale_fn_{chain*10000+3:06}(std::uint64_t);\n')
    lines.append('NODE generated_workload_entry(std::uint64_t n){ std::uint64_t v; switch(n%20){\n')
    for chain in range(CHAINS):
        lines.append(f'case {chain}: v=scale_fn_{chain*10000+3:06}(n);break;\n')
    lines.append('default:v=n;break;}volatile std::uint64_t keep=v;return keep;}\n')
    entry.write_text(''.join(lines)); shards.append(entry)
    started = time.monotonic()
    def compile_one(path):
        return command(['g++','-std=c++17','-O2','-g','-fPIC','-fno-omit-frame-pointer' if path==entry else '-fomit-frame-pointer',
                        '-fno-optimize-sibling-calls','-c',path,'-o',path.with_suffix('.o')])
    with ThreadPoolExecutor(max_workers=2) as pool:
        records = list(pool.map(compile_one,shards))
    module = folder/'libscale-no-fp.so'
    records.append(command(['g++','-shared','-Wl,--build-id',*[p.with_suffix('.o') for p in shards],'-o',module]))
    records.append(command(['objcopy','--only-keep-debug',module,folder/'libscale-no-fp.so.debug']))
    records.append(command(['strip','--strip-debug',module]))
    records.append(command(['objcopy','--add-gnu-debuglink='+str(folder/'libscale-no-fp.so.debug'),module]))
    fixture = folder/'fixture'
    records.append(command(['g++','-std=c++17','-O2','-g','-pthread','-fno-omit-frame-pointer','-mno-omit-leaf-frame-pointer','-Wl,--build-id',HERE/'many_thread_fixture.cpp','-ldl','-o',fixture]))
    symbols = subprocess.check_output(['nm','-D','--defined-only',str(module)],text=True)
    generated = [line for line in symbols.splitlines() if line.split()[-1].startswith('scale_fn_') or line.split()[-1]=='generated_workload_entry']
    assert len(generated)==FUNCTIONS, len(generated)
    assert len(set(line.split()[-1] for line in generated))==FUNCTIONS
    (folder/'dynamic-functions.txt').write_text('\n'.join(generated)+'\n')
    (folder/'Scale.cln').write_text('[solution]\nname="Large-symbol qualification"\nversion="1.0"\nprojects=[]\n')
    result = {'machine':platform.node(),'kernel':platform.release(),'compiler':subprocess.check_output(['g++','--version'],text=True).splitlines()[0],
              'generator':fingerprint(__file__),'functionCount':len(generated),'sourceShards':len(shards),'compilerParallelism':2,
              'wallMs':(time.monotonic()-started)*1000,'commands':records,'sources':[fingerprint(p) for p in shards],
              'artifacts':[fingerprint(p) for p in [module,folder/'libscale-no-fp.so.debug',fixture]],
              'moduleNotes':command(['readelf','-n',module]),'debugNotes':command(['readelf','-n',folder/'libscale-no-fp.so.debug'])}
    (folder/'build.json').write_text(json.dumps(result,indent=2)+'\n')
    print(folder/'build.json',flush=True)


def process_memory(root):
    all_processes = {}
    for path in Path('/proc').iterdir():
        if not path.name.isdigit(): continue
        try:
            raw=(path/'stat').read_text();tail=raw.rsplit(')',1)[1].split()
            all_processes[int(path.name)]={'pid':int(path.name),'parent':int(tail[1]),'rssBytes':int(tail[21])*os.sysconf('SC_PAGE_SIZE'),'cpuTicks':int(tail[11])+int(tail[12]),'name':raw.split('(',1)[1].rsplit(')',1)[0]}
        except (OSError,ValueError,IndexError): pass
    selected={root}
    for _ in range(5):
        selected.update(pid for pid,row in all_processes.items() if row['parent'] in selected)
    result=[]
    for pid in sorted(selected):
        row=all_processes.get(pid)
        if not row:continue
        try:
            status=Path(f'/proc/{pid}/status').read_text()
            row['vmHwmBytes']=int(next(line.split()[1] for line in status.splitlines() if line.startswith('VmHWM:')))*1024
            row['command']=Path(f'/proc/{pid}/cmdline').read_bytes().replace(b'\0',b' ').decode(errors='replace').strip()
            rollup=Path(f'/proc/{pid}/smaps_rollup').read_text()
            row['pssBytes']=int(next(line.split()[1] for line in rollup.splitlines() if line.startswith('Pss:')))*1024
        except (OSError,StopIteration):pass
        result.append(row)
    return {'monotonicNs':time.monotonic_ns(),'rssBytes':sum(r['rssBytes'] for r in result),'pssBytes':sum(r.get('pssBytes',0) for r in result),'processes':result}


def measure(args):
    out=args.output;out.mkdir(parents=True,exist_ok=False)
    server=Server(args.harness,out/'backend')
    memory=[];running=threading.Event();running.set();current_state='baseline'
    def monitor():
        while running.is_set():
            started=time.monotonic()
            sample=process_memory(server.process.pid);sample['phase']=current_state;memory.append(sample)
            running.wait(0) # no blocking on the set event
            time.sleep(max(.001,.01-(time.monotonic()-started)))
    thread=threading.Thread(target=monitor);thread.start()
    result={'machine':platform.node(),'kernel':platform.release(),'uid':os.geteuid(),
            'perfVersion':subprocess.check_output(['perf','--version'],text=True).strip(),'harness':fingerprint(args.harness),
            'build':json.loads((args.build/'build.json').read_text()),'cases':[],
            'sourceFiles':[fingerprint(__file__),fingerprint(HERE.parents[1]/'src-tauri/src/perf_capture.rs'),fingerprint(HERE.parents[1]/'src-tauri/src/perf_model.rs'),fingerprint(HERE.parents[1]/'src-tauri/src/commands/perf.rs')]}
    with (out/'target.log').open('w') as log:
        target=subprocess.Popen([str(args.build/'fixture'),str(args.build/'libscale-no-fp.so'),'2'],stdin=subprocess.PIPE,stdout=log,text=True)
        try:
            end=time.monotonic()+10
            while 'READY' not in (out/'target.log').read_text():
                if time.monotonic()>end or target.poll() is not None:raise RuntimeError('fixture startup failed')
                time.sleep(.025)
            time.sleep(1)
            result['baseline']=process_memory(server.process.pid)
            options={'frequency':99,'durationSeconds':3,'unwind':{'kind':'dwarf','stackBytes':8192}}
            current_state='capture'
            start=time.monotonic();response=server.request('start',pid=target.pid,options=options)
            assert response['ok'],response
            identifier=response['value']['id'];status_observations=[]
            end=time.monotonic()+90
            while True:
                begin=time.monotonic();response=server.request('status',id=identifier);elapsed=(time.monotonic()-begin)*1000
                assert response['ok'],response
                status=response['value'];current_state=status['state']
                status_observations.append({'monotonicNs':time.monotonic_ns(),'state':current_state,'requestMs':elapsed})
                if current_state in ['complete','partial','failed']:break
                if time.monotonic()>end:raise TimeoutError('capture did not complete')
                time.sleep(.01)
            query={'direction':'bottomUp','path':[],'limit':200,'tid':None,'threadName':None,'module':str(args.build/'libscale-no-fp.so'),'startNs':None,'endNs':None}
            bottom=server.request('tree',id=identifier,query=query);query['direction']='topDown';top=server.request('tree',id=identifier,query=query)
            result['cases'].append({'capture':status,'bottomUp':bottom,'topDown':top,'elapsedMs':(time.monotonic()-start)*1000,'statusObservations':status_observations,'targetSurvived':target.poll() is None})
            # New backend process reopens identical raw bytes; baseline and decode isolated.
            server.close();time.sleep(.1)
            server=Server(args.harness,out/'backend');result['reopenBaseline']=process_memory(server.process.pid)
            current_state='reopening';begin=time.monotonic();opened=server.request('reopen',id=identifier);assert opened['ok'],opened
            reopened=server.finished(identifier);result['reopen']={'elapsedMs':(time.monotonic()-begin)*1000,'capture':reopened}
        finally:
            if target.poll() is None:target.stdin.write('stop\n');target.stdin.flush()
            target.wait(timeout=15);target.stdin.close();result['normalTargetExit']=target.returncode
            running.clear();thread.join();server.close()
    result['memorySamples']=memory
    result['memoryMethod']='10 ms requested sampling of production harness and descendants: per-process RSS/PSS and VmHWM; RSS shared pages double-counted, peaks between observations can be missed; build/target excluded; stopped children not retained'
    result['baselineRevision']=subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip()
    (out/'results.json').write_text(json.dumps(result,indent=2)+'\n');print(out/'results.json',flush=True)


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);sub=parser.add_subparsers(dest='action',required=True)
    b=sub.add_parser('build');b.add_argument('--output',type=Path,required=True)
    m=sub.add_parser('measure');m.add_argument('--build',type=Path,required=True);m.add_argument('--output',type=Path,required=True);m.add_argument('--harness',type=Path,required=True)
    args=parser.parse_args()
    if args.action=='build':build(args.output)
    else:measure(args)
