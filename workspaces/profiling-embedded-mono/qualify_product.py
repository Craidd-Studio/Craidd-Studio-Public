#!/usr/bin/env python3
"""Qualifies the shipped prebuilt artifact and existing perf-map decode, no UI."""
import argparse,hashlib,json,os,platform,re,stat,statistics,subprocess,sys,time
from pathlib import Path
HERE=Path(__file__).resolve().parent;ROOT=HERE.parents[1];sys.path.insert(0,str(HERE.parent/'profiling-perf-backend'));from qualify_remaining import Server
p=argparse.ArgumentParser();p.add_argument('--harness',type=Path,required=True);p.add_argument('--output',type=Path,required=True);p.add_argument('--repetitions',type=int,default=5);a=p.parse_args();out=a.output.resolve();out.mkdir(parents=True,exist_ok=False);os.environ['DEBUGINFOD_URLS']='';os.environ['LC_ALL']='C'
def run(args):return subprocess.check_output(list(map(str,args)),text=True,stderr=subprocess.STDOUT)
def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()
materialized=json.loads(run([a.harness,'helper',out/'ide-cache']));helper=Path(materialized['identity']['path']);source=ROOT/'src-tauri/native/mono-map/mono_map.c';host=out/'host';assembly=out/'Hot.exe';missing=out/'missing.so';fake=out/'fake-runtime.so';fake_host=out/'fake-host'
run(['mcs','-optimize+','-out:'+str(assembly),HERE/'Hot.cs']);run(['c++','-O2','-g',HERE/'host.cpp','-ldl','-o',host]);run(['cc','-O2','-std=c11','-DCRAIDD_TEST_MISSING_EXPORT','-fPIC','-shared',source,'-ldl','-pthread','-o',missing]);run(['cc','-O2','-fPIC','-shared',HERE/'fake_runtime.c','-o',fake]);run(['c++','-O2',HERE/'fake_host.cpp','-ldl','-pthread','-o',fake_host])
result={'machine':platform.node(),'kernel':platform.release(),'perf':run(['perf','--version']).strip(),'mono':run(['mono','--version']).splitlines()[0],'artifact':materialized,'harness':{'path':str(a.harness),'sha256':sha(a.harness)},'fixture':{str(p):sha(p) for p in [host,assembly,fake,fake_host]},'failureCases':[],'naming':[]}
def environment(mode,iterations=2000):
 env=dict(os.environ);env.pop('LD_PRELOAD',None);env.pop('CRAIDD_MONO_FIXTURE_GATE',None);env.pop('CRAIDD_MONO_FIXTURE_BEFORE_INIT',None);env['CRAIDD_MONO_FIXTURE_BEFORE_INIT']='1';env['MONO_ENV_OPTIONS']='--jitmap';env['CRAIDD_MONO_FIXTURE_ITERATIONS']=str(iterations)
 if mode!='without':env['LD_PRELOAD']=str(missing if mode=='missing' else helper)
 return env
def cleanup_map(pid):
 # Deliberately retain fixture maps as the product does. No PID-path deletion.
 pass
def throughput(mode,iterations=20000):
 proc=subprocess.Popen([str(host),'/usr/lib/libmonosgen-2.0.so',str(assembly)],env=environment(mode,iterations),stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
 first=proc.stdout.readline();assert first.startswith('BEFORE_INIT');path=Path('/tmp')/f'perf-{proc.pid}.map';assert not path.exists() and not path.is_symlink(),'Existing map preserved; choose a fresh fixture PID'
 text,error=proc.communicate('go\n',timeout=45);path=Path('/tmp')/f'perf-{proc.pid}.map';data=path.read_bytes() if path.exists() else b'';elapsed=float(next(l.split()[1] for l in text.splitlines() if l.startswith('ELAPSED_MS')));record={'mode':mode,'pid':proc.pid,'exit':proc.returncode,'iterations':iterations,'elapsedMs':elapsed,'workPerSecond':iterations/(elapsed/1000),'mapEntries':data.count(b'\n'),'knownHotEntries':data.count(b'KnownManagedHot'),'modeBits':oct(stat.S_IMODE(path.stat().st_mode)) if data else None,'stderr':error};cleanup_map(proc.pid);return record
for mode in ['without','enabled','missing']:
 case=throughput(mode,2000);result['failureCases'].append(case);assert case['exit']==0
 if mode=='without':assert case['mapEntries']==0
 if mode=='enabled':assert case['knownHotEntries']>0 and case['modeBits']=='0o600'
 if mode=='missing':assert case['mapEntries']==0 and len(case['stderr'].splitlines())==1
for mode in ['normal','stale','symlink','fork','stress','cap']:
 env=environment('enabled');env['FAKE_LONG_NAME']='1' if mode=='cap' else '';env.pop('FAKE_LONG_NAME',None) if mode!='cap' else None
 proc=subprocess.Popen([str(fake_host),str(fake),'normal' if mode in ['stale','symlink'] else mode],env=env,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True);first=proc.stdout.readline();assert first.startswith('BEFORE_INIT');path=Path('/tmp')/f'perf-{proc.pid}.map';sentinel=out/'sentinel';sentinel.write_bytes(b'sentinel')
 assert not path.exists() and not path.is_symlink(),'Existing map preserved; choose a fresh fixture PID'
 if mode=='stale':
  with path.open('xb') as f:f.write(b'fixture-owned-stale\n')
  path.chmod(0o600)
 if mode=='symlink':path.symlink_to(sentinel)
 text,error=proc.communicate('go\n',timeout=30);data=path.read_bytes() if path.exists() else b'';case={'mode':mode,'exit':proc.returncode,'mapBytes':len(data),'mapEntries':data.count(b'\n'),'stderr':error};assert proc.returncode==0
 if mode=='stale':assert data==b'fixture-owned-stale\n' and len(error.splitlines())==1
 if mode=='symlink':assert sentinel.read_bytes()==b'sentinel' and len(error.splitlines())==1
 if mode=='fork':assert data.count(b'\n')==1 and not (Path('/tmp')/f'perf-{text.split()[1]}.map').exists()
 if mode=='stress':assert data.count(b'\n')==32000 and all(re.match(rb'^[0-9a-f]+ [0-9a-f]+ n+$',l) for l in data.splitlines())
 if mode=='cap':assert 0<len(data)<=16*1024*1024 and data.endswith(b'\n') and len(error.splitlines())==1
 result['failureCases'].append(case);cleanup_map(proc.pid)
for mode in ['without','enabled']:
 env=environment(mode,40000);env['CRAIDD_MONO_FIXTURE_GATE']='1';proc=subprocess.Popen([str(host),'/usr/lib/libmonosgen-2.0.so',str(assembly)],env=env,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True);server=None;lower=upper=None
 try:
  first=proc.stdout.readline();assert first.startswith('BEFORE_INIT');path=Path('/tmp')/f'perf-{proc.pid}.map';assert not path.exists() and not path.is_symlink(),'Existing map preserved; choose a fresh fixture PID';proc.stdin.write('go\n');proc.stdin.flush()
  while True:
   line=proc.stdout.readline()
   if line.startswith('HOT_RANGE '):_,start,size=line.split();lower=int(start,16);upper=lower+int(size,16)
   if line.startswith('READY'):break
   if proc.poll() is not None:raise RuntimeError('host startup failed')
  server=Server(a.harness,out/('capture-'+mode))
  if mode=='enabled':assert server.request('registerHelperLaunch',pid=proc.pid,helper=materialized['identity'])['ok']
  started=server.request('start',pid=proc.pid,options={'frequency':999,'durationSeconds':2,'unwind':{'kind':'dwarf','stackBytes':8192}});assert started['ok'],started;ident=started['value']['id']
  while server.request('status',id=ident)['value']['state']!='recording':time.sleep(.01)
  proc.stdin.write('go\n');proc.stdin.flush();capture=server.finished(ident);assert capture['state']!='failed',capture;raw=next((out/('capture-'+mode)).rglob('perf.data'));leaf=run(['perf','script','-G','--ns','-F','comm,pid,tid,time,period,event,ip,sym,dso','-i',raw]);total=named=0
  for line in leaf.splitlines():
   match=re.match(r'^\s*.*?\s+\d+/\d+\s+\d+\.\d+:\s+(\d+)\s+cpu-clock[^:]*:u:\s+([0-9a-fA-F]+)\s+(.*)$',line)
   if match and lower<=int(match[2],16)<upper:total+=int(match[1]);named+=int(match[1]) if 'KnownManagedHot' in match[3] else 0
  query={'direction':'bottomUp','path':[],'limit':200,'tid':None,'threadName':None,'module':None,'startNs':None,'endNs':None};tree=server.request('tree',id=ident,query=query);assert tree['ok'],tree;product_named=sum(v['selfWeight'] for v in tree['value']['children'] if v['frame']['symbolOrigin']=='perfMap' and 'KnownManagedHot' in v['frame']['symbol']);assert total>0
  if mode=='without':assert named==0 and product_named==0 and capture['launchHelper'] is None
  else:assert named/total>=.95 and product_named==named and capture['launchHelper']['helper']['sha256']==materialized['identity']['sha256']
  result['naming'].append({'mode':mode,'knownRange':[hex(lower),hex(upper)],'knownManagedWeight':total,'namedManagedWeight':named,'namedPct':100*named/total,'productNamedSelfWeight':product_named,'capture':capture,'targetSurvived':proc.poll() is None})
 finally:
  if server:server.close()
  if proc.poll() is None:proc.communicate('stop\n',timeout=30)
  cleanup_map(proc.pid)
pairs=[]
for repeat in range(a.repetitions):
 order=['without','enabled'] if repeat%2==0 else ['enabled','without'];cases={mode:throughput(mode) for mode in order};assert all(c['exit']==0 for c in cases.values());pairs.append({'order':order,'cases':cases,'slowdownPct':100*(1-cases['enabled']['workPerSecond']/cases['without']['workPerSecond'])})
values=sorted(p['slowdownPct'] for p in pairs);result['matchedOverhead']={'pairs':pairs,'medianSlowdownPct':statistics.median(values),'minSlowdownPct':min(values),'maxSlowdownPct':max(values),'q1SlowdownPct':statistics.quantiles(values,n=4,method='inclusive')[0],'q3SlowdownPct':statistics.quantiles(values,n=4,method='inclusive')[2],'basis':'Five alternating pairs, equal 20,000 known-hot invocations, host steady-clock around mono_jit_exec, no collector, includes execution/JIT and excludes host setup; descriptive only.'};result['gates']={'withoutMap':'PASS','enabledKnownMethodNaming':'PASS','missingExportOneDiagnosticAndSurvival':'PASS','staleAndSymlinkRefusal':'PASS','forkMapIsolation':'PASS','concurrentAppendRecords':'PASS','mapSizeCap':'PASS','versionHashProvenance':'PASS','targetSurvival':'PASS','matchedOverhead':'PASS' if len(pairs)>=5 else 'PARTIAL','desktopRunAndAttachIsolation':'NOT TESTED'}
(out/'results.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({'output':str(out),'gates':result['gates'],'namedShares':[v['namedPct'] for v in result['naming']],'overhead':{k:result['matchedOverhead'][k] for k in ['medianSlowdownPct','minSlowdownPct','maxSlowdownPct']}}))
