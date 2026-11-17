#!/usr/bin/env python3
"""Read-only declared-location prototype. Not production perf integration."""
import argparse,hashlib,json,os,platform,shutil,signal,subprocess,time
from pathlib import Path
os.environ["DEBUGINFOD_URLS"]=""
os.environ["LC_ALL"]="C"
ROOT=Path(__file__).resolve().parents[2]
def run(argv,timeout=30):
 r=subprocess.run(list(map(str,argv)),capture_output=True,text=True,timeout=timeout)
 if r.returncode: raise RuntimeError(f'{argv}: {r.returncode}: {r.stderr[-2000:]}')
 return r.stdout

def build_id(path):
 try:return next(l.split('Build ID:')[1].strip() for l in run(['readelf','-n',path],3).splitlines() if 'Build ID:' in l)
 except (StopIteration,RuntimeError):return None

def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def tree_hash(path):
 return {str(p.relative_to(path)):('symlink:'+os.readlink(p) if p.is_symlink() else sha(p)) for p in path.rglob('*') if p.is_symlink() or p.is_file()} if path.exists() else {}
def index(folder):
 start=time.monotonic();ids={};seen=0;cut=False
 for p in sorted(folder.iterdir()):
  if seen>=10000 or time.monotonic()-start>5:cut=True;break
  seen+=1
  if p.is_symlink() or not p.is_file():continue
  with p.open('rb') as f:magic=f.read(4)
  if magic!=b'\x7fELF':continue
  ident=build_id(p)
  if ident:ids.setdefault(ident,[]).append(str(p))
 return {'entries':seen,'elapsedMs':(time.monotonic()-start)*1000,'cutShort':cut,'ids':ids}
def main():
 a=argparse.ArgumentParser();a.add_argument('--output',type=Path,required=True);args=a.parse_args();out=args.output.resolve();out.mkdir(exist_ok=False,parents=True)
 result={'scope':'Fixture-only private perf build-ID cache mechanism; production settings/manifest/reopen UI not implemented','machine':platform.node(),'kernel':platform.release(),'perf':run(['perf','--version']).strip(),'cases':[],'gates':{}}
 realcache=Path.home()/'.debug';before=tree_hash(realcache)
 build=out/'build';build.mkdir();symbols=out/'sibling-symbols';symbols.mkdir();elsewhere=out/'unrelated';elsewhere.mkdir();decoys=out/'decoy';decoys.mkdir()
 lib=build/'liblocation.so';debug=build/'liblocation.so.debug'
 run(['g++','-O2','-g','-fPIC','-shared','-fno-omit-frame-pointer','-fno-optimize-sibling-calls','-Wl,--build-id',ROOT/'workspaces/profiling-symbol-locations/hot.cpp','-o',lib]);run(['objcopy','--only-keep-debug',lib,debug]);run(['strip','--strip-unneeded',lib]);run(['objcopy','--add-gnu-debuglink='+str(debug),lib]);good=symbols/debug.name;debug.rename(good)
 renamed=elsewhere/'artifact-unrelated-name.elf';shutil.copy2(good,renamed)
 decoy=decoys/debug.name;run(['g++','-O2','-g','-fPIC','-shared','-DDECOY=1','-Wl,--build-id',ROOT/'workspaces/profiling-symbol-locations/hot.cpp','-o',decoy])
 fixture=build/'fixture';run(['g++','-O2','-g','-fno-omit-frame-pointer','-pthread',ROOT/'workspaces/profiling-perf-qualification/many_thread_fixture.cpp','-ldl','-o',fixture])
 expected=build_id(lib);result['fixture']={'module':str(lib),'moduleSha256':sha(lib),'buildId':expected,'debug':str(good),'debugSha256':sha(good),'decoyBuildId':build_id(decoy)}
 target=subprocess.Popen([str(fixture),str(lib),'2'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
 try:
  while 'READY' not in target.stdout.readline():
   if target.poll() is not None:raise RuntimeError('fixture failed')
  raw=out/'perf.data';rec=subprocess.Popen(['perf','record','--no-buildid-cache','--timestamp','--clockid','mono','--user-callchains','--per-thread','--no-inherit','-m','128','-e','cpu-clock:u','-F','99','-p',str(target.pid),'--call-graph','dwarf,8192','-o',str(raw),'--','sleep','2'],stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True);_,err=rec.communicate(timeout=15);result['recordStderr']=err
  if rec.returncode:raise RuntimeError(err)
  for label,location in [('undeclared',None),('sibling',good),('renamed',renamed),('decoy',decoy)]:
   cache=out/('cache-'+label);cache.mkdir();served=None;valid=False
   if label=='renamed':
    located=index(elsewhere);location=Path(located['ids'][expected][0]);result['renamedIndex']=located
   if location:
    valid=build_id(location)==expected
    if valid:
     run(['perf','--buildid-dir',cache,'buildid-cache','-a',lib])
     # perf's qualified build-ID entry links into <module>/<build-id>/elf.
     entries=[p for p in cache.rglob('elf') if p.is_file()]
     module_entry=next(p for p in entries if p.parent.name==expected)
     (module_entry.parent/'debug').symlink_to(location)
     served={'path':str(location),'sha256':sha(location),'buildId':build_id(location)}
   started=time.monotonic();text=run(['perf','--buildid-dir',cache,'script','--full-source-path','-F','comm,pid,tid,time,period,event,ip,sym,dso,srcline','-i',raw],60)
   (out/(label+'.script')).write_text(text)
   hot=[l for l in text.splitlines() if 'hidden_symbol_location_hot' in l];source=[l for l in text.splitlines() if 'profiling-symbol-locations/hot.cpp:' in l]
   result['cases'].append({'case':label,'validBuildId':valid,'servedBy':served,'hotNameRecords':len(hot),'sourceLineRecords':len(source),'decodeMs':(time.monotonic()-started)*1000,'conservativeWithhold':bool(location and not valid)})
  old=sha(good);moved=good.with_suffix('.moved');good.rename(moved)
  missing_text=run(['perf','--buildid-dir',out/'cache-sibling','script','-F','comm,pid,tid,time,period,event,ip,sym,dso,srcline','-i',raw],60)
  result['reopenPrototype']={'servedPathMissing':not good.exists(),'originalSha256':old,'withhold':not good.exists(),'remainingHotNameRecords':missing_text.count('hidden_symbol_location_hot')};moved.rename(good)
  many=out/'ten-thousand';many.mkdir()
  shutil.copy2(good,many/'artifact-symbols.elf')
  for i in range(9999):(many/f'file-{i:05d}').write_bytes(b'fixture\n')
  result['index']=index(many);result['targetSurvived']=target.poll() is None
 finally:
  if target.poll() is None:target.communicate('stop\n',timeout=15)
 result['userDebugCacheUnchanged']=before==tree_hash(realcache)
 cases={c['case']:c for c in result['cases']};result['gates']={
  'noDeclaredLocation':'PASS' if cases['undeclared']['hotNameRecords']==0 else 'FAIL',
  'siblingLocation':'PASS' if cases['sibling']['hotNameRecords'] and cases['sibling']['sourceLineRecords'] else 'FAIL',
  'renamedLocation':'PASS' if cases['renamed']['hotNameRecords'] and cases['renamed']['sourceLineRecords'] else 'FAIL',
  'decoyVerification':'PASS' if cases['decoy']['conservativeWithhold'] else 'FAIL',
  'privateCaches':'PASS' if len(list(out.glob('cache-*')))==4 else 'FAIL',
  'userCacheUnchanged':'PASS' if result['userDebugCacheUnchanged'] else 'FAIL',
  'tenThousandIndex':'PASS' if result['index']['elapsedMs']<5000 or result['index']['cutShort'] else 'FAIL',
  'productionManifestReopen':'NOT TESTED','retentionCleanup':'NOT TESTED','desktopSettings':'NOT TESTED'}
 (out/'results.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({'output':str(out),'gates':result['gates']}))
if __name__=='__main__':main()
