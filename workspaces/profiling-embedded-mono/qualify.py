#!/usr/bin/env python3
"""Fixture-only embedded Mono helper and paired throughput qualification."""
import argparse,hashlib,json,os,platform,statistics,subprocess,time,stat
from pathlib import Path
os.environ["DEBUGINFOD_URLS"]=""
os.environ["LC_ALL"]="C"
ROOT=Path(__file__).resolve().parents[2]
def run(argv):return subprocess.run(list(map(str,argv)),check=True,capture_output=True,text=True).stdout
def digest(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def main():
 parser=argparse.ArgumentParser();parser.add_argument('--output',type=Path,required=True);parser.add_argument('--repetitions',type=int,default=5);args=parser.parse_args();out=args.output.resolve();out.mkdir(parents=True,exist_ok=False)
 here=ROOT/'workspaces/profiling-embedded-mono';host=out/'host';assembly=out/'Hot.exe';helper=out/'helper.so';missing=out/'missing.so'
 run(['mcs','-optimize+','-out:'+str(assembly),here/'Hot.cs']);run(['c++','-O2','-g',here/'host.cpp','-ldl','-o',host])
 for path,flags in [(helper,[]),(missing,['-DFORCE_MISSING_EXPORT'])]:run(['gcc','-O2','-g','-fPIC','-shared',*flags,here/'map_helper.c','-ldl','-pthread','-o',path])
 result={'scope':'Fixture-only dlsym initialization path; not production launch support','machine':platform.node(),'kernel':platform.release(),'mono':run(['mono','--version']).splitlines()[0],'fixture':{str(p):digest(p) for p in [host,assembly,helper,missing]},'cases':[]}
 def launch(mode,iterations=20000):
  env=dict(os.environ);env['MONO_ENV_OPTIONS']='--jitmap';env['CRAIDD_MONO_FIXTURE_ITERATIONS']=str(iterations);env.pop('LD_PRELOAD',None)
  if mode!='without':env['LD_PRELOAD']=str(helper if mode=='enabled' else missing)
  p=subprocess.Popen([str(host),'/usr/lib/libmonosgen-2.0.so',str(assembly)],env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
  text,error=p.communicate(timeout=30);path=Path('/tmp')/f'perf-{p.pid}.map';data=path.read_bytes() if path.exists() else b''
  elapsed=float(next(l.split()[1] for l in text.splitlines() if l.startswith('ELAPSED_MS')))
  case={'mode':mode,'pid':p.pid,'exit':p.returncode,'elapsedMs':elapsed,'workPerSecond':iterations/(elapsed/1000),'iterations':iterations,'stdout':text,'stderr':error,'mapEntries':data.count(b'\n'),'knownHotEntries':data.count(b'KnownManagedHot'),'mapMode':oct(stat.S_IMODE(path.stat().st_mode)) if path.exists() else None,'mapSha256':hashlib.sha256(data).hexdigest() if data else None}
  if data:(out/(str(p.pid)+'.map')).write_bytes(data)
  # Only the map created by this observed fixture child is removed after normal exit.
  if path.exists() and p.returncode is not None:path.unlink()
  return case
 for mode in ['without','enabled','missing-export']:result['cases'].append(launch(mode,2000))
 pairs=[]
 for i in range(args.repetitions):
  order=['without','enabled'] if i%2==0 else ['enabled','without'];items={}
  for mode in order:items[mode]=launch(mode)
  pairs.append({'order':order,'cases':items,'slowdownPct':100*(1-items['enabled']['workPerSecond']/items['without']['workPerSecond'])})
 vals=sorted(v['slowdownPct'] for v in pairs);result['matchedOverhead']={'pairs':pairs,'medianSlowdownPct':statistics.median(vals),'minSlowdownPct':min(vals),'maxSlowdownPct':max(vals),'basis':'host steady-clock around mono_jit_exec, equal 20,000 known-hot invocations per run; includes execution/JIT and excludes host setup; no perf collector; no significance claim'}
 a,b,c=result['cases'];result['gates']={'withoutMap':'PASS' if a['exit']==0 and a['mapEntries']==0 else 'FAIL','knownHotMap':'PASS' if b['exit']==0 and b['knownHotEntries']>0 else 'FAIL','mapPermissions':'PASS' if b['mapMode']=='0o600' else 'FAIL','missingExportSurvival':'PASS' if c['exit']==0 and len(c['stderr'].splitlines())==1 else 'FAIL','matchedOverheadMeasurement':'PASS' if len(pairs)>=5 else 'PARTIAL','sampledWeightNaming':'NOT TESTED','desktopLaunchOption':'NOT TESTED','productionAttachIsolation':'NOT TESTED'}
 (out/'results.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({'output':str(out),'gates':result['gates'],'medianSlowdownPct':result['matchedOverhead']['medianSlowdownPct']}))
if __name__=='__main__':main()
