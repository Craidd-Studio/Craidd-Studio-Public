#!/usr/bin/env python3
"""Alternating matched native perf overhead experiment; no UI/product code.

Persistent all-busy targets, completion-counter snapshot brackets, adjacent
baseline controls, explicit enable acknowledgements and child-only raw caps.
Build/prepare first. Start run only in a coordinated exclusive workload slot.
"""
import argparse
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
import mmap
import os
from pathlib import Path
import platform
import resource
import select
import shutil
import signal
import statistics
import struct
import subprocess
import sys
import threading
import time

sys.dont_write_bytecode = True
from generate_native_workload import generate

RAW_CAP = 512 * 1024 * 1024
TOTAL_RAW_CAP = 8 * 1024 * 1024 * 1024
MODES = ['fp99', 'dwarf99', 'dwarf999']


def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as stream:
        while block := stream.read(1024 * 1024): h.update(block)
    return h.hexdigest()


def fresh(path):
    if path.exists() and any(path.iterdir()): raise RuntimeError('output must be fresh')
    path.mkdir(parents=True, exist_ok=True)


def policy():
    return {n: Path('/proc/sys/' + n.replace('.', '/')).read_text().strip()
            for n in ['kernel.perf_event_paranoid', 'kernel.kptr_restrict', 'kernel.yama.ptrace_scope']}


def proc_ticks(pid):
    tail = Path(f'/proc/{pid}/stat').read_text().rsplit(')', 1)[1].split()
    return {'user': int(tail[11]), 'system': int(tail[12]), 'birth': int(tail[19])}


def system_busy_ticks():
    values = [int(n) for n in Path('/proc/stat').read_text().splitlines()[0].split()[1:]]
    return sum(values[i] for i in [0, 1, 2, 5, 6, 7] if i < len(values))


def thermal():
    sensors = []
    for name_path in sorted(Path('/sys/class/hwmon').glob('hwmon*/name')):
        try: name = name_path.read_text().strip()
        except OSError: continue
        if name not in ['k10temp', 'nvme']: continue
        for path in sorted(name_path.parent.glob('temp*_input')):
            try:
                key = path.name.removesuffix('_input')
                label = name_path.parent / (key + '_label')
                crit = name_path.parent / (key + '_crit')
                sensors.append({'name': name, 'label': label.read_text().strip() if label.exists() else key,
                                'milliC': int(path.read_text()), 'criticalMilliC': int(crit.read_text()) if crit.exists() else None})
            except (OSError, ValueError): continue
    frequencies = {}
    for path in sorted(Path('/sys/devices/system/cpu').glob('cpu[0-9]*/cpufreq/scaling_cur_freq')):
        try: frequencies[path.parent.parent.name] = int(path.read_text())
        except (OSError, ValueError): pass
    throttle = {}
    for path in sorted(Path('/sys/devices/system/cpu').glob('cpu[0-9]*/thermal_throttle/*throttle_count')):
        try: throttle[str(path)] = int(path.read_text())
        except (OSError, ValueError): pass
    return {'monotonicNs': time.monotonic_ns(), 'sensors': sensors, 'scalingCurFreqKHz': frequencies,
            'throttleCounters': throttle, 'throttleObservability': 'available' if throttle else 'NOT TESTED: no readable throttle counters'}


def build(output):
    fresh(output)
    here = Path(__file__).parent
    generated = output / 'generated_workload.cpp'
    generated.write_text(generate())
    commands = [
        ['g++', '-std=c++17', '-O2', '-g', '-fPIC', '-shared', '-fomit-frame-pointer', '-fno-optimize-sibling-calls', '-Wl,--build-id', str(generated), '-o', str(output / 'libgenerated-no-fp.so')],
        ['g++', '-std=c++17', '-O2', '-g', '-pthread', '-fno-omit-frame-pointer', '-mno-omit-leaf-frame-pointer', '-Wl,--build-id', str(here / 'matched_overhead_fixture.cpp'), '-ldl', '-o', str(output / 'fixture')],
    ]
    logs = []
    for index, command in enumerate(commands):
        r = subprocess.run(command, capture_output=True, text=True, timeout=30)
        (output / f'build-{index}.stderr').write_text(r.stderr)
        logs.append({'command': command, 'exitCode': r.returncode, 'stderr': r.stderr})
        if r.returncode: raise RuntimeError('build failed')
    result = {'timestampUtc': datetime.now(timezone.utc).isoformat(), 'commands': logs,
              'compiler': subprocess.check_output(['g++', '--version'], text=True).splitlines()[0],
              'sourceHashes': {p.name: digest(p) for p in [here / 'matched_overhead.py', here / 'matched_overhead_fixture.cpp', here / 'generate_native_workload.py', generated]},
              'binaryHashes': {p.name: digest(p) for p in [output / 'fixture', output / 'libgenerated-no-fp.so']}, 'buildIds': {}}
    for name in ['fixture', 'libgenerated-no-fp.so']:
        text = subprocess.check_output(['readelf', '-n', str(output / name)], text=True)
        result['buildIds'][name] = next(line.split('Build ID:', 1)[1].strip() for line in text.splitlines() if 'Build ID:' in line)
    (output / 'build.json').write_text(json.dumps(result, indent=2) + '\n')
    print(output)


def readline(stream, deadline):
    remaining = deadline - time.monotonic()
    if remaining <= 0 or not select.select([stream], [], [], remaining)[0]: raise RuntimeError('fixture/ack response timeout')
    line = stream.readline()
    if not line: raise RuntimeError('fixture output closed')
    return line.decode().rstrip('\n')


def snapshot(target, token, workers):
    requested = time.monotonic_ns()
    target.stdin.write(f'snapshot {token}\n'.encode()); target.stdin.flush()
    row = readline(target.stdout, time.monotonic() + 5).split()
    acknowledged = time.monotonic_ns()
    if len(row) != workers + 4 or row[:2] != ['SNAP', token]: raise RuntimeError('invalid counter snapshot acknowledgement')
    first, last = int(row[2]), int(row[3])
    return {'token': token, 'requestedMonotonicNs': requested, 'acknowledgedMonotonicNs': acknowledged,
            'readBeginMonotonicNs': first, 'readEndMonotonicNs': last, 'midpointMonotonicNs': (first + last) / 2,
            'readBracketNs': last - first, 'completed': [int(v) for v in row[4:]]}


def drain(stream, result):
    kept = bytearray(); total = 0
    while block := stream.read(8192):
        total += len(block)
        kept.extend(block[:max(0, 65536 - len(kept))])
    result.update(text=bytes(kept).decode(errors='replace'), totalBytes=total, omittedBytes=total-len(kept))


def limits():
    resource.setrlimit(resource.RLIMIT_FSIZE, (RAW_CAP, RAW_CAP))
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))


class Collector:
    def __init__(self, perf, mode, tids, output):
        self.output = output; fresh(output)
        self.ack = ''; self.enabled_ns = None
        self.data = output / 'perf.data'; self.stderr = {}; self.monitor_flags = []; self.done = threading.Event()
        self.control_r, self.control_w = os.pipe(); self.ack_r, self.ack_w = os.pipe()
        frequency = 999 if mode == 'dwarf999' else 99
        self.command = [perf, 'record', '--no-buildid-cache', '--clockid', 'mono', '--timestamp', '--per-thread', '--no-inherit', '--user-callchains',
                        '-e', 'cpu-clock:u', '-F', str(frequency), '--call-graph', 'fp' if mode == 'fp99' else 'dwarf,8192', '-m', '128',
                        '-t', ','.join(tids), '--delay=-1', '--control', f'fd:{self.control_r},{self.ack_w}', '-o', str(self.data)]
        env = os.environ | {'LC_ALL': 'C', 'DEBUGINFOD_URLS': ''}
        self.process = subprocess.Popen(self.command, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
                                        pass_fds=(self.control_r, self.ack_w), preexec_fn=limits, start_new_session=True, env=env)
        os.close(self.control_r); os.close(self.ack_w)
        self.reader = threading.Thread(target=drain, args=(self.process.stderr, self.stderr)); self.reader.start()
        self.monitor = threading.Thread(target=self.watch); self.monitor.start()
        os.write(self.control_w, b'enable\n')
        if not select.select([self.ack_r], [], [], 5)[0]:
            self.stop(); raise RuntimeError('perf enable acknowledgement timed out')
        self.ack = os.read(self.ack_r, 64).decode(errors='replace')
        self.enabled_ns = time.monotonic_ns()
        if self.ack.replace('\0','').strip() != 'ack' or self.process.poll() is not None:
            self.stop(); raise RuntimeError('perf did not acknowledge active collection: ack=' + repr(self.ack) + ' stderr=' + str(self.stderr))

    def watch(self):
        while not self.done.wait(.01):
            if self.process.poll() is not None: return
            if self.data.exists() and self.data.stat().st_size >= RAW_CAP - 1024 * 1024:
                self.monitor_flags.append({'flag': 'raw cap monitor stopped owned collector', 'monotonicNs': time.monotonic_ns()})
                try: self.process.send_signal(signal.SIGINT)
                except ProcessLookupError: pass
                return

    def stop(self):
        if self.process.poll() is None:
            self.process.send_signal(signal.SIGINT)
            try: self.process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                self.monitor_flags.append({'flag': 'collector finalisation deadline, killed owned collector', 'monotonicNs': time.monotonic_ns()})
                self.process.kill(); self.process.wait()
        self.done.set(); self.monitor.join(timeout=2); self.reader.join(timeout=5)
        for fd in [self.control_w, self.ack_r]:
            try: os.close(fd)
            except OSError: pass
        (self.output / 'record.stderr').write_text(self.stderr.get('text', ''))
        return {'command': self.command, 'collectorPid': self.process.pid, 'enableAck': self.ack, 'enabledMonotonicNs': self.enabled_ns,
                'exitCode': self.process.returncode, 'rawCapBytes': RAW_CAP, 'rawBytes': self.data.stat().st_size if self.data.exists() else 0,
                'rawPath': str(self.data), 'stderr': self.stderr, 'flags': self.monitor_flags,
                'expectedStopExit': self.process.returncode in [0, -signal.SIGINT]}


def window(target, workers, seconds, token, collector=None):
    environment_before = thermal()
    system_before = system_busy_ticks(); target_before = proc_ticks(target.pid)
    collector_before = proc_ticks(collector.process.pid) if collector else None
    begin = snapshot(target, token + '-begin', workers)
    active_begin = collector.process.poll() is None if collector else None
    time.sleep(seconds)
    end = snapshot(target, token + '-end', workers)
    active_end = collector.process.poll() is None if collector else None
    collector_after = proc_ticks(collector.process.pid) if collector and active_end else None
    target_after = proc_ticks(target.pid); system_after = system_busy_ticks()
    environment_after = thermal()
    elapsed = (end['midpointMonotonicNs'] - begin['midpointMonotonicNs']) / 1e9
    deltas = [b-a for a,b in zip(begin['completed'], end['completed'])]
    hz = os.sysconf('SC_CLK_TCK')
    target_cpu = ((target_after['user']+target_after['system'])-(target_before['user']+target_before['system'])) / hz
    perf_cpu = ((collector_after['user']+collector_after['system'])-(collector_before['user']+collector_before['system'])) / hz if collector_after else 0
    other = (system_after-system_before) / hz - target_cpu - perf_cpu
    flags = []
    if collector and not (active_begin and active_end): flags.append('collector was not alive across both measured boundaries')
    if begin['readBracketNs'] > 1000000 or end['readBracketNs'] > 1000000: flags.append('snapshot counter-read bracket exceeds 1 ms')
    if other > .05 * len(os.sched_getaffinity(0)) * elapsed: flags.append('estimated other busy CPU exceeds 5% of available logical CPUs')
    if any(v <= 0 for v in deltas): flags.append('a worker completed no work in the interval')
    for env in [environment_before, environment_after]:
        if any(s['criticalMilliC'] is not None and s['milliC'] >= s['criticalMilliC']-5000 for s in env['sensors']):
            flags.append('a measured sensor is within 5 C of its readable critical threshold'); break
    for name,value in environment_after['throttleCounters'].items():
        if value > environment_before['throttleCounters'].get(name, value): flags.append('readable thermal throttle counter increased')
    return {'begin': begin, 'end': end, 'elapsedSeconds': elapsed, 'completedPerWorker': deltas, 'completedTotal': sum(deltas),
            'completedPerSecond': sum(deltas) / elapsed, 'collectorActiveAtBegin': active_begin, 'collectorActiveAtEnd': active_end,
            'targetTicksBefore': target_before, 'targetTicksAfter': target_after, 'collectorTicksBefore': collector_before, 'collectorTicksAfter': collector_after,
            'systemBusyTicksBefore': system_before, 'systemBusyTicksAfter': system_after,
            'targetCpuSecondsApprox': target_cpu, 'collectorCpuSecondsApprox': perf_cpu, 'otherBusyCpuSecondsApprox': other,
            'cpuAccountingNote': 'proc reads bracket snapshots approximately; residual is a concurrency flag, not exact causal accounting',
            'environmentBefore': environment_before, 'environmentAfter': environment_after, 'flags': sorted(set(flags))}


def scan_data(path, measured_start_ns=None, measured_end_ns=None):
    """Skip stack payloads and scan perf record headers; explicit little-endian ABI.

    LOST type2 and LOST_SAMPLES type13 remain separate. This bounded analysis
    runs only after measured intervals, so symbol/stack decoding cannot perturb them.
    """
    result = {'rawSha256': digest(path), 'recordTypes': {}, 'samples': 0, 'samplesInMeasuredWindow': 0, 'samplesPerTidInMeasuredWindow': {},
              'lostRecords': 0, 'lostCount': 0, 'lostSampleCounterRecords': 0, 'lostSampleCounter': 0, 'diagnostics': []}
    with path.open('rb') as stream:
        with mmap.mmap(stream.fileno(), 0, access=mmap.ACCESS_READ) as data:
            if data[:8] != b'PERFILE2': raise RuntimeError('unsupported perf data magic/endian')
            attr_size, attr_offset, attr_bytes, offset, size = struct.unpack_from('<QQQQQ', data, 16)
            if not attr_size or attr_bytes % attr_size: raise RuntimeError('invalid event attribute section')
            events=[]; event_ids={}
            for attr in range(attr_offset,attr_offset+attr_bytes,attr_size):
                kind,abi_size,config=struct.unpack_from('<IIQ',data,attr)
                sample_type=struct.unpack_from('<Q',data,attr+24)[0]
                ids_offset,ids_size=struct.unpack_from('<QQ',data,attr+attr_size-16)
                if ids_size%8: raise RuntimeError('invalid event identifier section')
                ids=list(struct.unpack_from('<'+'Q'*(ids_size//8),data,ids_offset))
                event={'type':kind,'config':config,'sampleType':sample_type,'ids':ids}
                events.append(event)
                for identifier in ids: event_ids[identifier]=event
            sampled=[event for event in events if event['type']==1 and event['config']==0]
            if len(sampled)!=1: raise RuntimeError('scanner requires one cpu-clock event')
            sample_type=sampled[0]['sampleType']
            if any(event['type']!=1 or event['config'] not in [0,9] for event in events):
                raise RuntimeError('unexpected event beyond cpu-clock and control dummy')
            result['events']=events
            result.update(sampleType=sample_type, dataOffset=offset, dataBytes=size, rawBytes=len(data))
            if sample_type & 6 != 6: raise RuntimeError('missing declared TID/time sample fields')
            end = offset + size
            if end > len(data): result['diagnostics'].append('data section truncated'); end=len(data)
            types = Counter(); first=None; last=None
            while offset+8 <= end:
                kind,misc,record_size = struct.unpack_from('<IHH', data, offset)
                if record_size < 8 or offset+record_size>end:
                    result['diagnostics'].append('incomplete or invalid raw record'); break
                types[kind] += 1
                if kind == 2:
                    if record_size<24: result['diagnostics'].append('short LOST record')
                    else: result['lostRecords']+=1;result['lostCount']+=struct.unpack_from('<Q',data,offset+16)[0]
                elif kind == 13:
                    if record_size<16: result['diagnostics'].append('short LOST_SAMPLES record')
                    else: result['lostSampleCounterRecords']+=1;result['lostSampleCounter']+=struct.unpack_from('<Q',data,offset+8)[0]
                elif kind == 9:
                    cursor=offset+8
                    current_type=sample_type
                    if sample_type & (1<<16):
                        identifier=struct.unpack_from('<Q',data,cursor)[0];cursor+=8
                        event=event_ids.get(identifier)
                        if event is None: raise RuntimeError('unknown sample event identifier')
                        if event['config']!=0: raise RuntimeError('unexpected dummy-event sample')
                        current_type=event['sampleType']
                    if current_type & 1: cursor+=8
                    pid,tid=struct.unpack_from('<II',data,cursor);cursor+=8
                    stamp=struct.unpack_from('<Q',data,cursor)[0]
                    result['samples']+=1;first=stamp if first is None else min(first,stamp);last=stamp if last is None else max(last,stamp)
                    if measured_start_ns is not None and measured_start_ns<=stamp<=measured_end_ns:
                        result['samplesInMeasuredWindow']+=1
                        key=str(tid);result['samplesPerTidInMeasuredWindow'][key]=result['samplesPerTidInMeasuredWindow'].get(key,0)+1
                offset+=record_size
            result['recordTypes']={str(k):v for k,v in types.items()};result.update(firstSampleNs=first,lastSampleNs=last)
    result['lossAccounting']='LOST and LOST_SAMPLES counters are kept separate, never added'
    result['captureState']='PARTIAL' if result['lostCount'] or result['lostSampleCounter'] or result['diagnostics'] else 'complete at raw-record scan'
    return result


def percentile(values, fraction):
    ordered=sorted(values);position=(len(ordered)-1)*fraction;lo=int(position);hi=min(lo+1,len(ordered)-1)
    return ordered[lo]+(ordered[hi]-ordered[lo])*(position-lo)


def summary(trials):
    grouped={}
    for row in trials:
        if row['mode']=='baseline': continue
        key=f"{row['workers']}-{row['mode']}";grouped.setdefault(key,[]).append(row)
    result={}
    for key,rows in grouped.items():
        values=[r['pairedSlowdownPct'] for r in rows]
        result[key]={'repetitions':len(rows),'medianSlowdownPct':statistics.median(values),'p25SlowdownPct':percentile(values,.25),'p75SlowdownPct':percentile(values,.75),
                     'minimumSlowdownPct':min(values),'maximumSlowdownPct':max(values),'medianThroughputDropPct':statistics.median([r['pairedThroughputDropPct'] for r in rows]),
                     'trialIds':[r['id'] for r in rows],'flaggedTrials':[r['id'] for r in rows if r['flags']],
                     'partialCaptures':[r['id'] for r in rows if r.get('rawAnalysis',{}).get('captureState')!='complete at raw-record scan']}
    return result


def analyse_existing(output):
    """Resume deferred analysis only; never launch a target or collector."""
    result=json.loads((output/'results.json').read_text())
    if not result.get('measurementIntervalsFinishedUtc'): raise RuntimeError('measurement phase incomplete')
    result['analysisRunnerSha256']=digest(Path(__file__))
    if 'error' in result: result['priorAnalysisFailure']=result.pop('error')
    for row in result['trials']:
        if row['mode']=='baseline': continue
        w=row['window']
        row['rawAnalysis']=scan_data(Path(row['collector']['rawPath']),w['begin']['readBeginMonotonicNs'],w['end']['readEndMonotonicNs'])
        if row['rawAnalysis']['captureState'].startswith('PARTIAL'): row['flags'].append('capture loss or raw diagnostic: PARTIAL')
        if row['rawAnalysis']['samplesInMeasuredWindow']==0: row['flags'].append('no samples in measured interval')
        expected=set(next(group['selectedTids'] for group in result['workerGroups'] if group['workers']==row['workers']))
        actual=set(row['rawAnalysis']['samplesPerTidInMeasuredWindow'])
        row['rawAnalysis']['allSelectedTidsSampledInWindow']=expected==actual
        row['rawAnalysis']['observedSamplesPerSecondPerTid']={tid:count/w['elapsedSeconds'] for tid,count in row['rawAnalysis']['samplesPerTidInMeasuredWindow'].items()}
    profiled=[t for t in result['trials'] if t['mode']!='baseline']
    result['summary']=summary(result['trials'])
    enabled=all(t['window']['collectorActiveAtBegin'] and t['window']['collectorActiveAtEnd'] and
                t['collector']['enabledMonotonicNs']<t['window']['begin']['readBeginMonotonicNs'] and
                t['rawAnalysis']['allSelectedTidsSampledInWindow'] for t in profiled)
    result['gates']={'matchedInstrumentationAndSnapshotWindows':'PASS',
                     'fiveAlternatingPairedRepetitions':'PASS' if len(result['trials'])==70 and len(profiled)==30 and all(r['repetitions']==5 for r in result['summary'].values()) else 'PARTIAL',
                     'collectorEnabledAcrossMeasuredIntervals':'PASS' if enabled else 'PARTIAL',
                     'rawCapAndLoss':'PARTIAL' if any(t['collector']['flags'] or t['collector']['rawBytes']>=RAW_CAP or not t['collector']['expectedStopExit'] or t['rawAnalysis']['captureState'].startswith('PARTIAL') for t in profiled) else 'PASS',
                     'observedMeasurementConditions':'PARTIAL' if any(t['window']['flags'] for t in result['trials']) else 'PASS',
                     'targetSurvivalAndNormalExit':'PASS' if all(t['targetAliveAfterInterval'] for t in result['trials']) and all(g['normalExitCode']==0 for g in result['workerGroups']) else 'FAIL',
                     'policyUnchanged':'PASS' if result['policyUnchanged'] else 'FAIL',
                     'thermalThrottleCausality':'NOT TESTED: no readable throttle counters; temperature/frequency snapshots only',
                     'significance':'NOT TESTED: descriptive small sample','uiAndProductOverhead':'NOT TESTED'}
    (output/'analysed-results.json').write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps(result['summary'],indent=2))


def experiment(args):
    fresh(args.output)
    if shutil.disk_usage(args.output).free < 8*1024**3: raise RuntimeError('need8GiB free for bounded raw evidence')
    perf=shutil.which('perf')
    if not perf: raise RuntimeError('perf missing')
    here=Path(__file__).parent;build_info=json.loads((args.build/'build.json').read_text())
    env_governors={}
    for p in Path('/sys/devices/system/cpu').glob('cpu[0-9]*/cpufreq/scaling_governor'):
        try: env_governors[p.parent.parent.name]=p.read_text().strip()
        except OSError: pass
    result={'formatVersion':1,'timestampUtc':datetime.now(timezone.utc).isoformat(),'baselineRevision':subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip(),
            'build':build_info,'runnerSha256':digest(Path(__file__)),'machine':{'uname':list(platform.uname()),'logicalCpus':os.cpu_count(),'allowedCpus':sorted(os.sched_getaffinity(0)),
            'cpuModel':next(v.split(':',1)[1].strip() for v in Path('/proc/cpuinfo').read_text().splitlines() if v.startswith('model name')),'governors':env_governors},
            'perfVersion':subprocess.check_output([perf,'--version'],text=True).strip(),'credentials':[v for v in Path('/proc/self/status').read_text().splitlines() if v.startswith(('Uid:','CapEff:','NoNewPrivs:','Seccomp:'))],
            'policyBefore':policy(),'conditions':{'workers':[16,32],'repetitions':args.repetitions,'measuredSecondsRequested':args.seconds,'warmupSeconds':2,
            'preRollAfterEnableAckSeconds':.05,'postRollSeconds':.05,'dataPagesPerTid':128,'rawCapPerCapture':RAW_CAP,'aggregateRawEvidenceLimit':TOTAL_RAW_CAP,
            'coordination':'run requires an explicitly confirmed slot with agent captures/builds paused; background desktop is observed, not frozen',
            'counterSemantics':'cache-line-aligned relaxed atomic store once per completed generated-workload call; snapshot read brackets recorded; same instrumentation in every mode',
            'baselinePairing':'linear interpolation of adjacent baseline throughputs at profiled midpoint; time-equivalent slowdown100*(baseline/profile-1), descriptive only',
            'noSignificanceClaim':True},'trials':[],'workerGroups':[]}
    progress=args.output/'progress.json'
    def checkpoint(): progress.write_text(json.dumps(result,indent=2)+'\n')
    raw_total=0
    try:
        for workers in [16,32]:
            target=subprocess.Popen([str(args.build/'fixture'),str(args.build/'libgenerated-no-fp.so'),str(workers)],stdin=subprocess.PIPE,stdout=subprocess.PIPE,
                                    stderr=subprocess.PIPE,start_new_session=True,bufsize=0)
            group={'workers':workers,'pid':target.pid,'birth':proc_ticks(target.pid)['birth'],'startup':[]}
            collector=None
            try:
                deadline=time.monotonic()+10;tids=[]
                while True:
                    line=readline(target.stdout,deadline);group['startup'].append(line)
                    if line.startswith('THREAD '): tids.append(line.split()[2])
                    if line=='READY': break
                if len(tids)!=workers: raise RuntimeError('worker count mismatch')
                group['selectedTids']=tids;result['workerGroups'].append(group)
                time.sleep(2)
                for repetition in range(args.repetitions):
                    order=MODES[repetition%3:]+MODES[:repetition%3]
                    if repetition%2: order=list(reversed(order))
                    sequence=['baseline']
                    for mode in order: sequence += [mode,'baseline']
                    rep_rows=[]
                    for index,mode in enumerate(sequence):
                        token=f'w{workers}-r{repetition}-{index}-{mode}'
                        if mode!='baseline':
                            if raw_total+RAW_CAP>TOTAL_RAW_CAP: raise RuntimeError('aggregate raw evidence budget exhausted')
                            collector=Collector(perf,mode,tids,args.output/token)
                            time.sleep(.05)
                        usage_before=resource.getrusage(resource.RUSAGE_CHILDREN)
                        measured=window(target,workers,args.seconds,token,collector)
                        row={'id':token,'workers':workers,'repetition':repetition,'mode':mode,'order':order,'window':measured,'flags':list(measured['flags'])}
                        if collector:
                            time.sleep(.05)
                            row['collector']=collector.stop();collector=None
                            usage_after=resource.getrusage(resource.RUSAGE_CHILDREN)
                            row['collectorAccountedChildCpuSeconds']={'user':usage_after.ru_utime-usage_before.ru_utime,'system':usage_after.ru_stime-usage_before.ru_stime,
                                                                    'note':'includes record finalisation outside measured window; not added to throughput slowdown'}
                            raw_total+=row['collector']['rawBytes']
                            row['flags'] += [v['flag'] for v in row['collector']['flags']]
                            if not row['collector']['expectedStopExit']: row['flags'].append('unexpected collector exit')
                            if row['collector']['rawBytes']>=RAW_CAP: row['flags'].append('raw file reached hard cap')
                        row['targetAliveAfterInterval']=target.poll() is None and proc_ticks(target.pid)['birth']==group['birth']
                        if not row['targetAliveAfterInterval']: raise RuntimeError('target identity changed')
                        result['trials'].append(row);rep_rows.append(row);checkpoint()
                        print(token,round(measured['completedPerSecond'],3),'work/s',row['flags'],flush=True)
                    for index,row in enumerate(rep_rows):
                        if row['mode']=='baseline': continue
                        before,after=rep_rows[index-1],rep_rows[index+1]
                        midpoint=lambda r:(r['window']['begin']['midpointMonotonicNs']+r['window']['end']['midpointMonotonicNs'])/2
                        weight=(midpoint(row)-midpoint(before))/(midpoint(after)-midpoint(before))
                        baseline=(1-weight)*before['window']['completedPerSecond']+weight*after['window']['completedPerSecond']
                        row.update(pairedBaselineIds=[before['id'],after['id']],baselineInterpolationWeight=weight,pairedBaselineCompletedPerSecond=baseline,
                                   pairedSlowdownPct=100*(baseline/row['window']['completedPerSecond']-1),pairedThroughputDropPct=100*(1-row['window']['completedPerSecond']/baseline))
                    checkpoint()
            finally:
                if collector: collector.stop()
                if target.poll() is None:
                    target.stdin.write(b'stop\n');target.stdin.flush()
                    group['shutdown']=[]
                    while True:
                        line=readline(target.stdout,time.monotonic()+10);group['shutdown'].append(line)
                        if line=='STOPPED': break
                    target.wait(timeout=10)
                group['normalExitCode']=target.returncode
                target.stdin.close();target.stdout.close();target.stderr.close();checkpoint()
        result['measurementIntervalsFinishedUtc']=datetime.now(timezone.utc).isoformat();checkpoint()
        print('MEASUREMENT INTERVALS FINISHED; raw-record analysis starts now',flush=True)
        for row in result['trials']:
            if row['mode']=='baseline': continue
            w=row['window'];row['rawAnalysis']=scan_data(Path(row['collector']['rawPath']),w['begin']['readBeginMonotonicNs'],w['end']['readEndMonotonicNs'])
            if row['rawAnalysis']['captureState'].startswith('PARTIAL'): row['flags'].append('capture loss or raw diagnostic: PARTIAL')
            if row['rawAnalysis']['samplesInMeasuredWindow']==0: row['flags'].append('no samples in measured interval')
            checkpoint()
        result['summary']=summary(result['trials'])
        result['gates']={'matchedInstrumentationAndSnapshotWindows':'PASS','fiveAlternatingPairedRepetitions':'PASS' if args.repetitions==5 else 'PARTIAL',
                         'collectorEnabledAcrossMeasuredIntervals':'PASS' if all(t['window']['collectorActiveAtBegin'] and t['window']['collectorActiveAtEnd'] for t in result['trials'] if t['mode']!='baseline') else 'PARTIAL',
                         'rawCapAndLoss':'PARTIAL' if any(t['collector']['flags'] or t['collector']['rawBytes']>=RAW_CAP or not t['collector']['expectedStopExit'] or t['rawAnalysis']['captureState'].startswith('PARTIAL') for t in result['trials'] if t['mode']!='baseline') else 'PASS',
                         'observedMeasurementConditions':'PARTIAL' if any(t['window']['flags'] for t in result['trials']) else 'PASS',
                         'targetSurvivalAndNormalExit':'PASS' if all(t['targetAliveAfterInterval'] for t in result['trials']) and all(g['normalExitCode']==0 for g in result['workerGroups']) else 'FAIL','thermalThrottleCausality':'NOT TESTED: sensor/counter flags only','significance':'NOT TESTED: descriptive small sample',
                         'uiAndProductOverhead':'NOT TESTED'}
    except (OSError,RuntimeError,subprocess.SubprocessError) as error:
        result['error']=str(error);result['gates']={'experiment':'BLOCKED'};checkpoint();raise
    finally:
        result['policyAfter']=policy();result['policyUnchanged']=result['policyBefore']==result['policyAfter'];result['rawTotalBytes']=raw_total
        result.setdefault('gates',{})['policyUnchanged']='PASS' if result['policyUnchanged'] else 'FAIL'
        (args.output/'results.json').write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps(result['summary'],indent=2))


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);sub=parser.add_subparsers(dest='action',required=True)
    b=sub.add_parser('build');b.add_argument('--output',type=Path,required=True)
    r=sub.add_parser('run');r.add_argument('--build',type=Path,required=True);r.add_argument('--output',type=Path,required=True)
    r.add_argument('--repetitions',type=int,default=5);r.add_argument('--seconds',type=float,default=1)
    s=sub.add_parser('scan');s.add_argument('path',type=Path)
    a=sub.add_parser('analyse');a.add_argument('--output',type=Path,required=True)
    args=parser.parse_args()
    if args.action=='build': build(args.output)
    elif args.action=='scan': print(json.dumps(scan_data(args.path),indent=2))
    elif args.action=='analyse': analyse_existing(args.output)
    else:
        if not 1<=args.repetitions<=5 or not .5<=args.seconds<=1: parser.error('bounded experiment permits1..5repetitions and0.5..1second windows')
        experiment(args)
