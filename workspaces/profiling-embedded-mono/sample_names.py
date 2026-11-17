#!/usr/bin/env python3
"""Known-method address range provides the same managed-weight denominator in both modes."""
import argparse,json,os,platform,re,subprocess,time
from pathlib import Path
os.environ["DEBUGINFOD_URLS"]=""
os.environ["LC_ALL"]="C"
p=argparse.ArgumentParser();p.add_argument('--build',type=Path,required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args();out=a.output.resolve();out.mkdir(parents=True,exist_ok=False);build=a.build.resolve()
r={'scope':'Known managed hot method weight only, identified by fixture-reported JIT address range; excludes unrelated runtime weight','machine':platform.node(),'kernel':platform.release(),'perf':subprocess.check_output(['perf','--version'],text=True).strip(),'cases':[]}
for mode in ['without','enabled']:
 env=dict(os.environ);env.pop('LD_PRELOAD',None);env['MONO_ENV_OPTIONS']='--jitmap';env['CRAIDD_MONO_FIXTURE_ITERATIONS']='40000';env['CRAIDD_MONO_FIXTURE_GATE']='1'
 if mode=='enabled':env['LD_PRELOAD']=str(build/'helper.so')
 host=subprocess.Popen([str(build/'host'),'/usr/lib/libmonosgen-2.0.so',str(build/'Hot.exe')],env=env,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
 log=[];lower=upper=None
 try:
  while True:
   line=host.stdout.readline();log.append(line)
   if line.startswith('HOT_RANGE '):_,start,size=line.split();lower=int(start,16);upper=lower+int(size,16)
   if line.startswith('READY'):break
   if host.poll() is not None:raise RuntimeError('host startup failed')
  raw=out/(mode+'.data');record=subprocess.Popen(['perf','record','--no-buildid-cache','--timestamp','--clockid','mono','--user-callchains','--per-thread','--no-inherit','-m','128','-e','cpu-clock:u','-F','999','--call-graph','dwarf,8192','-p',str(host.pid),'-o',str(raw),'--','sleep','2'],stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
  time.sleep(.15);host.stdin.write('go\n');host.stdin.flush();_,error=record.communicate(timeout=15)
  if record.returncode:raise RuntimeError(error)
  leaf_text=subprocess.check_output(['perf','script','-G','-F','comm,pid,tid,time,period,event,ip,sym,dso','-i',str(raw)],text=True);(out/(mode+'.leaf.script')).write_text(leaf_text)
  leaf_weight=leaf_named=0
  for line in leaf_text.splitlines():
   leaf=re.match(r'^\s*\S+\s+\d+(?:/|\s+)\d+\s+\d+\.\d+:\s+(\d+)\s+\S+:\s+([0-9a-fA-F]+)\s+(.*)$',line)
   if leaf and lower<=int(leaf[2],16)<upper:
    leaf_weight+=int(leaf[1]);leaf_named+=int(leaf[1]) if 'KnownManagedHot' in leaf[3] else 0
  text=subprocess.check_output(['perf','script','-F','comm,pid,tid,time,period,event,ip,sym,dso','-i',str(raw)],text=True);(out/(mode+'.script')).write_text(text)
  weight=named=total=0;period=0;counted=False;sample_named=False
  def finish():
   global weight,named,total
   total+=period
   if counted:weight+=period;named+=period if sample_named else 0
  for line in text.splitlines():
   header=re.match(r'^\S.*?\s\d+(?:/|\s+)\d+\s+\d+\.\d+:\s+(\d+)\s+cpu-clock',line)
   if header:finish();period=int(header[1]);counted=False;sample_named=False;continue
   frame=re.match(r'^\s+([0-9a-fA-F]+)\s+(.*)$',line)
   if frame and lower<=int(frame[1],16)<upper:counted=True;sample_named='KnownManagedHot' in frame[2]
  finish();map_path=Path('/tmp')/f'perf-{host.pid}.map';data=map_path.read_bytes() if map_path.exists() else b''
  r['cases'].append({'mode':mode,'pid':host.pid,'knownMethodRange':[hex(lower),hex(upper)],'rawLeafKnownManagedWeight':leaf_weight,'rawLeafNamedWeight':leaf_named,'rawLeafNamedPct':100*leaf_named/leaf_weight if leaf_weight else None,'knownManagedWeight':weight,'namedKnownManagedWeight':named,'namedPct':100*named/weight if weight else None,'totalSampledWeight':total,'mapEntries':data.count(b'\n'),'recordStderr':error})
 finally:
  if host.poll() is None:host.communicate('stop\n',timeout=15)
  map_path=Path('/tmp')/f'perf-{host.pid}.map'
  if map_path.exists():map_path.unlink()
r['gates']={'rawLeafWithoutMap':'PASS' if r['cases'][0]['rawLeafKnownManagedWeight']>0 and r['cases'][0]['rawLeafNamedPct']==0 else 'FAIL','rawLeafHelperMap':'PASS' if r['cases'][1]['rawLeafKnownManagedWeight']>0 and r['cases'][1]['rawLeafNamedPct']>=95 else 'FAIL','withoutMapNaming':'PASS' if r['cases'][0]['knownManagedWeight']>0 and r['cases'][0]['namedPct']==0 else 'FAIL','helperMapNaming':'PASS' if r['cases'][1]['knownManagedWeight']>0 and r['cases'][1]['namedPct']>=95 else 'FAIL'}
(out/'results.json').write_text(json.dumps(r,indent=2)+'\n');print(json.dumps({'output':str(out),'gates':r['gates'],'shares':[c['namedPct'] for c in r['cases']]}))
