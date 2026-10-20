import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const url=s=>`data:text/javascript;base64,${Buffer.from(s).toString('base64')}`;
const hooks=url('export const useRef=current=>({current});export const useCallback=callback=>callback;');
let {outputText}=ts.transpileModule(await readFile(new URL('../src/components/layout/ResizeHandle.tsx',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}});
outputText=outputText.replaceAll('"react"',JSON.stringify(hooks)).replaceAll('"react/jsx-runtime"',JSON.stringify(import.meta.resolve('react/jsx-runtime')));
const ResizeHandle=(await import(url(outputText))).default;
function fixture(orientation='vertical'){
  const deltas=[],captures=[],releases=[];
  const currentTarget={setPointerCapture:id=>captures.push(id),releasePointerCapture:id=>releases.push(id)};
  const props=ResizeHandle({orientation,onDrag:delta=>deltas.push(delta)}).props;
  const event=patch=>({pointerId:7,isPrimary:true,button:0,buttons:1,clientX:100,clientY:100,currentTarget,target:{},...patch});
  return {props,event,deltas,captures,releases};
}
test('A zero-button move after a valid drag never changes panel size',()=>{
  const f=fixture();f.props.onPointerDown(f.event());f.props.onPointerMove(f.event({clientX:40}));
  f.props.onPointerMove(f.event({buttons:0,clientX:142}));f.props.onPointerMove(f.event({clientX:160}));
  assert.deepEqual(f.deltas,[-60]);assert.deepEqual(f.captures,[7]);assert.deepEqual(f.releases,[7]);
});
test('Cancel and capture loss end the same pointer; other pointers cannot resize it',()=>{
  for(const end of ['onPointerCancel','onLostPointerCapture','onPointerUp']){
    const f=fixture();f.props.onPointerDown(f.event());f.props.onPointerMove(f.event({pointerId:8,clientX:500}));
    f.props.onPointerMove(f.event({clientX:110}));f.props[end](f.event());f.props.onPointerMove(f.event({clientX:300}));assert.deepEqual(f.deltas,[10]);
  }
});
test('Only primary left-button drags start, and horizontal deltas use Y',()=>{
  for(const patch of [{button:2},{isPrimary:false}]){
    const f=fixture();f.props.onPointerDown(f.event(patch));f.props.onPointerMove(f.event({clientX:200}));assert.deepEqual(f.deltas,[]);assert.deepEqual(f.captures,[]);
  }
  const f=fixture('horizontal');f.props.onPointerDown(f.event());f.props.onPointerMove(f.event({clientX:500,clientY:80}));assert.deepEqual(f.deltas,[-20]);
});
