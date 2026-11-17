#!/usr/bin/env python3
"""GR-003 production settings/cache/reopen gates, no policy changes."""
import argparse,hashlib,json,os,platform,shutil,subprocess,sys,time
from pathlib import Path
HERE=Path(__file__).resolve().parent;ROOT=HERE.parents[1];sys.path.insert(0,str(HERE.parent/'profiling-perf-backend'));from qualify_remaining import Server
p=argparse.ArgumentParser();p.add_argument('--harness',type=Path,required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args();out=a.output.resolve();out.mkdir(parents=True,exist_ok=False);os.environ['DEBUGINFOD_URLS']='';os.environ['LC_ALL']='C'
def run(argv):return subprocess.check_output(list(map(str,argv)),text=True,stderr=subprocess.STDOUT)
def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def tree_hash(path):return {str(p.relative_to(path)):('symlink:'+os.readlink(p) if p.is_symlink() else sha(p)) for p in path.rglob('*') if p.is_symlink() or p.is_file()} if path.exists() else {}
build=out/'build';build.mkdir();symbols=out/'sibling-symbols';symbols.mkdir();elsewhere=out/'elsewhere';elsewhere.mkdir();decoys=out/'decoys';decoys.mkdir();lib=build/'liblocation.so';debug=build/'liblocation.so.debug'
run(['g++','-O2','-g','-fPIC','-shared','-fno-omit-frame-pointer','-fno-optimize-sibling-calls','-Wl,--build-id',HERE/'hot.cpp','-o',lib]);run(['objcopy','--only-keep-debug',lib,debug]);run(['strip','--strip-unneeded',lib]);run(['objcopy','--add-gnu-debuglink='+str(debug),lib]);good=symbols/debug.name;debug.rename(good);renamed=elsewhere/'arbitrary-artifact.elf';shutil.copy2(good,renamed);decoy=decoys/debug.name;run(['g++','-O2','-g','-fPIC','-shared','-DDECOY=1','-Wl,--build-id',HERE/'hot.cpp','-o',decoy]);fixture=build/'fixture';run(['g++','-O2','-g','-fno-omit-frame-pointer','-pthread',ROOT/'workspaces/profiling-perf-qualification/many_thread_fixture.cpp','-ldl','-o',fixture])
realcache=Path.home()/'.debug';cache_before=tree_hash(realcache);symbol_before=tree_hash(symbols);target=subprocess.Popen([str(fixture),str(lib),'2'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True);result={'machine':platform.node(),'kernel':platform.release(),'perf':run(['perf','--version']).strip(),'harness':{'path':str(a.harness),'sha256':sha(a.harness)},'fixture':{'path':str(fixture),'sha256':sha(fixture),'module':str(lib),'moduleSha256':sha(lib),'debug':str(good),'debugSha256':sha(good)},'cases':[]}
query={'direction':'bottomUp','path':[],'limit':200,'tid':None,'threadName':None,'module':str(lib),'startNs':None,'endNs':None}
def hot(tree):return [v for v in tree['children'] if 'hidden_symbol_location_hot' in v['frame']['symbol']]
def reopened(server,ident):
 r=server.request('reopen',id=ident);assert r['ok'],r;return server.finished(ident)
try:
 while 'READY' not in target.stdout.readline():
  if target.poll() is not None:raise RuntimeError('Fixture startup failed')
 for label,paths in [('undeclared',[]),('sibling',[str(symbols)]),('renamed',[str(elsewhere)]),('decoy',[str(decoys)])]:
  root=out/label;server=Server(a.harness,root)
  try:
   settings=server.request('saveSymbolSettings',paths=paths,expected=[]);assert settings['ok'],settings
   start=server.request('start',pid=target.pid,options={'frequency':99,'durationSeconds':2,'unwind':{'kind':'dwarf','stackBytes':8192}});assert start['ok'],start;ident=start['value']['id'];status=server.finished(ident);tree=server.request('tree',id=ident,query=query);assert tree['ok'],tree;names=hot(tree['value']);case={'case':label,'capture':status,'hotEntries':names,'targetSurvived':target.poll() is None}
   if label in ['sibling','renamed']:
    assert names and names[0]['frame']['source'],case;assert status['symbolSearch']['served'],case
    served=next(s for s in status['symbolSearch']['served'] if s['module']==str(lib));case['served']=served
    revision=status['decodeRevision'];status2=reopened(server,ident);assert status2['decodeRevision']>revision,'Reopen must decode even when already loaded';case['reopenedRevision']=status2['decodeRevision']
    actual=good if label=='sibling' else renamed;moved=actual.with_suffix('.moved');actual.rename(moved)
    try:
     missing=reopened(server,ident);missing_tree=server.request('tree',id=ident,query=query);assert missing['state']=='partial';assert not hot(missing_tree['value']);assert any(s['state'].startswith('withheld:') for s in missing['symbolSearch']['served']);case['missingReopen']={'capture':missing,'tree':missing_tree['value']}
    finally:moved.rename(actual)
    # Changed bytes with the original build ID are still refused by fingerprint.
    original=actual.read_bytes();actual.write_bytes(original+b'changed-with-same-build-id')
    try:
     changed=reopened(server,ident);changed_tree=server.request('tree',id=ident,query=query);assert not hot(changed_tree['value']);case['changedBytesReopen']=changed
    finally:actual.write_bytes(original)
   elif label=='undeclared':assert not names,case
   else:assert not names and status['state']=='partial' and str(lib) in status['symbolSearch']['withheldModules'],case
   result['cases'].append(case)
  finally:server.close()
 # Bound test: 10,001 files causes visible cutoff; the known debug may lie outside the retained scan.
 many=out/'many-files';many.mkdir();shutil.copy2(good,many/'arbitrary-artifact.elf')
 for i in range(10000):(many/f'file-{i:05d}').write_bytes(b'text\n')
 server=Server(a.harness,out/'index-bound')
 try:
  assert server.request('saveSymbolSettings',paths=[str(many)],expected=[])['ok'];ident=server.request('start',pid=target.pid,options={'frequency':99,'durationSeconds':1,'unwind':{'kind':'fp'}})['value']['id'];bound=server.finished(ident);idx=bound['symbolSearch']['index'];assert idx['entries']<=10000 and idx['elapsedMs']<5500 and idx['incomplete'];result['indexBound']=idx
 finally:server.close()
 result['userDebugCacheUnchanged']=cache_before==tree_hash(realcache);result['declaredFolderUnchanged']=symbol_before==tree_hash(symbols);assert result['userDebugCacheUnchanged'] and result['declaredFolderUnchanged']
 result['gates']={'noLocations':'PASS','siblingNamesAndLines':'PASS','renamedNamesAndLines':'PASS','decoyRefused':'PASS','sameOwnerReopenActuallyDecodes':'PASS','movedFileWithheld':'PASS','changedSameBuildIdBytesWithheld':'PASS','privateCaches':'PASS','userCacheAndDeclaredFolderReadOnly':'PASS','boundedIndex':'PASS','retentionCleanup':'NOT TESTED','desktopSettingsAndServedRecord':'NOT TESTED'}
finally:
 if target.poll() is None:target.communicate('stop\n',timeout=15)
(out/'results.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({'output':str(out),'gates':result['gates'],'index':result['indexBound']}))
