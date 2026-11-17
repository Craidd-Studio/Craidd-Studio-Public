import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {evidenceDirectory} from './lib/harness.mjs';
import {disposableUnity} from './lib/unity-copy.mjs';

test('diagnostic overlay renders in a disposable graphical Game view',{skip:process.env.CRAIDD_TEST_UNITY!=='1',timeout:480000},async t=>{
 const dir=await evidenceDirectory('unity-overlay');
 const unity=await disposableUnity(dir,`overlay-${randomUUID()}`,{graphics:true});t.after(()=>unity.close());
 await unity.waitFor('rendering Editor ready',()=>readFile(join(unity.signals,'ready'),'utf8'),240000);
 await unity.command('play',60);
 await unity.waitFor('rendering Play',async()=>{const s=await unity.status();return s.playing&&s.frames>2?s:false;});
 await unity.command('allocate');
 await unity.command('screenshot');
 const status=await unity.waitFor('Game overlay repaint and retained value',async()=>{const s=await unity.status();return s.overlayDraws>0&&s.nativeLiveBytes===1048576?s:false;});
 const png=await unity.waitFor('actual Game-view capture',()=>readFile(join(unity.signals,'overlay.png')));
 assert.ok(png.length>1000);
 assert.equal(png.subarray(1,4).toString(),'PNG');
 const {writeFile}=await import('node:fs/promises');
 await writeFile(join(dir,'overlay-state.json'),JSON.stringify({project:unity.project,editor:unity.editor,version:unity.version,status},null,2));
 await unity.command('clear');assert.equal((await unity.status()).nativeLiveBytes,0);
});
