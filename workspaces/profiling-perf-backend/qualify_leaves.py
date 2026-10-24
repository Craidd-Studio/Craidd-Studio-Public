#!/usr/bin/env python3
"""Fresh production-manager captures; independently compare every leaf weight."""
import argparse,hashlib,json,os,platform,re,subprocess,time
from pathlib import Path
from qualify_remaining import Server
p=argparse.ArgumentParser();p.add_argument('--harness',type=Path,required=True);p.add_argument('--mono-build',type=Path,required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args();a.output.mkdir(parents=True,exist_ok=False)
os.environ['DEBUGINFOD_URLS']='';os.environ['LC_ALL']='C'
source=a.output/'normal.cpp';source.write_text('''#include <atomic>
#include <thread>
#include <iostream>
#include <pthread.h>
__attribute__((noinline)) unsigned long known_hot(unsigned long n){for(int i=0;i<10000;i++)n=(n*1664525+1013904223)^(n>>7);return n;}
int main(){std::atomic<bool> stop{false};unsigned long sink=3;std::thread worker([&]{pthread_setname_np(pthread_self(),"native-hot");while(!stop.load())sink=known_hot(sink);});std::cout<<"READY"<<std::endl;std::string s;std::getline(std::cin,s);stop=true;worker.join();std::cout<<sink;}
''');native=a.output/'normal';subprocess.run(['c++','-g','-O2','-fno-omit-frame-pointer',str(source),'-pthread','-o',str(native)],check=True)
result={'machine':platform.node(),'kernel':platform.release(),'perf':subprocess.check_output(['perf','--version'],text=True).strip(),'harness':{'path':str(a.harness),'sha256':hashlib.sha256(a.harness.read_bytes()).hexdigest()},'cases':[]}
for mode,unwind in [('native-fp',{'kind':'fp'}),('native-dwarf',{'kind':'dwarf','stackBytes':8192}),('mono-dwarf',{'kind':'dwarf','stackBytes':8192})]:
 env=dict(os.environ);env.pop('LD_PRELOAD',None);managed=mode.startswith('mono');env['CRAIDD_MONO_FIXTURE_GATE']='1';env['CRAIDD_MONO_FIXTURE_ITERATIONS']='40000'
 if managed:env['LD_PRELOAD']=str(a.mono_build/'helper.so')
 target=subprocess.Popen([str(a.mono_build/'host'),'/usr/lib/libmonosgen-2.0.so',str(a.mono_build/'Hot.exe')] if managed else [str(native)],env=env,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
 server=None
 try:
  log=[]
  while True:
   line=target.stdout.readline();log.append(line)
   if line.startswith('READY'):break
   if target.poll() is not None:raise RuntimeError('Fixture exited before READY: '+target.stderr.read())
  root=a.output/mode;server=Server(a.harness,root);started=server.request('start',pid=target.pid,options={'frequency':999 if managed else 99,'durationSeconds':2,'unwind':unwind});assert started['ok'],started;ident=started['value']['id']
  if managed:
   while server.request('status',id=ident)['value']['state']!='recording':time.sleep(.01)
   target.stdin.write('go\n');target.stdin.flush()
  status=server.finished(ident);assert status['state']!='failed',status
  raw=next(root.rglob('perf.data'));leaf=subprocess.check_output(['perf','script','-G','--ns','-F','comm,pid,tid,time,period,event,ip,sym,dso','-i',str(raw)],text=True);chain=subprocess.check_output(['perf','script','--ns','-F','comm,pid,tid,time,period,event,ip,sym,dso','-i',str(raw)],text=True)
  (root/'leaf.script').write_text(leaf);(root/'chain.script').write_text(chain)
  periods=[int(m[1]) for line in leaf.splitlines() if (m:=re.match(r'^\s*.*?\s+\d+/\d+\s+\d+\.\d+:\s+(\d+)\s+cpu-clock',line))]
  parsed=json.loads(subprocess.check_output([str(a.harness),'reconcile',str(root/'leaf.script'),str(root/'chain.script')],text=True));coverage=status['summary']['unwindCoverage'];assert parsed['leafCount']==len(periods)==coverage['total']['samples'];assert parsed['leafWeight']==sum(periods)==coverage['total']['weight']==parsed['selfWeight'];assert parsed['literalIpCount']==len(periods)
  q={'direction':'bottomUp','path':[],'limit':200,'tid':None,'threadName':None,'module':None,'startNs':None,'endNs':None};tree=server.request('tree',id=ident,query=q);assert tree['ok'];assert tree['value']['totalWeight']==sum(periods);assert not tree['value']['omittedChildren'];assert sum(c['selfWeight'] for c in tree['value']['children'])==sum(periods)
  alive=target.poll() is None
  # Reopen while the same fixture and map incarnation are alive.
  server.close();server=Server(a.harness,root)
  reopen=server.request('reopen',id=ident);assert reopen['ok'],reopen;reopened=server.finished(ident);assert reopened['summary']['unwindCoverage']['total']['weight']==sum(periods)
  case={'mode':mode,'fixturePid':target.pid,'fixtureLog':log,'raw':str(raw),'manifest':status,'independentLeafSamples':len(periods),'independentLeafWeight':sum(periods),'reconciled':parsed,'targetSurvived':alive,'tree':tree['value'],'reopenedTotals':reopened['summary']['unwindCoverage']['total'],'gates':{'leafSampleAndWeightTotals':'PASS','literalIPsRetained':'PASS','selfTreeTotals':'PASS','reopen':'PASS','targetSurvival':'PASS' if alive else 'FAIL','lossReporting':'PASS'}}
  if managed:case['gates']['unwindFailureReproduced']='PASS' if coverage['total']['empty']>0 else 'FAIL'
  result['cases'].append(case)
 finally:
  if server:server.close()
  if target.poll() is None:target.communicate('stop\n',timeout=30)
  path=Path('/tmp')/f'perf-{target.pid}.map'
  if managed and path.exists() and target.returncode is not None:path.unlink()
result['gates']={'nativeFP':'PASS','nativeDWARF':'PASS','unwindDefeatingModule':'PASS' if result['cases'][-1]['gates']['unwindFailureReproduced']=='PASS' else 'FAIL','desktopCoverageUI':'NOT TESTED'}
(a.output/'results.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({'output':str(a.output),'gates':result['gates'],'totals':[{k:c['manifest']['summary']['unwindCoverage']['total'][k] for k in ['samples','weight','empty','truncated','mismatch']} for c in result['cases']]}))
