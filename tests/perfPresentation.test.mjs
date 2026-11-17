import {test} from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import {readFile} from 'node:fs/promises';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const url=s=>`data:text/javascript;base64,${Buffer.from(s).toString('base64')}`;
const g=globalThis.__perfPresentation={capture:null};
const store=url(`export const perfAction=()=>Promise.resolve();export const perfBusy=s=>['starting','recording','stopping','parsing','finalizing'].includes(s);export const usePerf=()=>({captures:globalThis.__perfPresentation.capture?[globalThis.__perfPresentation.capture]:[],selected:'capture',setup:true,tab:"Calls",options:{frequency:99,durationSeconds:10,unwind:{kind:'fp'}},discovery:{available:true},range:['',''],tid:'',name:'',module:'',direction:'bottomUp',set:()=>{}});`);
const profile=url(`export const useProfiling=selector=>selector({profile:{active:true,id:'p',name:'Fixture',target:{pid:10,birth:20}}});`),solution=url(`export const useSolution={getState:()=>({revealFile:()=>{}})};`);
let source=ts.transpileModule(await readFile(new URL('../src/components/panels/PerfPanel.tsx',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText;
for(const [name,replacement]of Object.entries({'../../store/perfStore':store,'../../store/profilingStore':profile,'../../store/solutionStore':solution,react:import.meta.resolve('react'),'react/jsx-runtime':import.meta.resolve('react/jsx-runtime')}))source=source.replaceAll(JSON.stringify(name),JSON.stringify(replacement));
const Panel=(await import(url(source))).default;
const capture=state=>({id:'capture',state,summary:null,createdMs:0,label:'Fixture',target:{pid:10,birth:20},options:{frequency:99,durationSeconds:10,unwind:{kind:'fp'}},coverage:{retainedSamples:0},threadsAtStart:[{tid:10,name:'Fixture'}],buildIds:[],reasons:[],rawBytes:0});
test('native collection and decoding render safely before a summary exists',()=>{
 for(const state of ['starting','recording','stopping','parsing','finalizing']){g.capture=capture(state);const html=renderToStaticMarkup(createElement(Panel,{expanded:true}));assert.ok(html.includes(state.toUpperCase()));assert.ok(html.includes('Stop capture'));assert.ok(html.includes('Call trees appear when decoding completes.'));}
});
test('empty perf view explains target selection and frame-pointer limits',()=>{g.capture=null;const html=renderToStaticMarkup(createElement(Panel,{expanded:false}));assert.ok(html.includes('Review capture'));assert.ok(html.includes('FP can miss callers'));assert.ok(html.includes('≈10 ms'));assert.ok(html.includes('≈1 ms'));assert.ok(html.includes('Find where CPU time is spent'));});
