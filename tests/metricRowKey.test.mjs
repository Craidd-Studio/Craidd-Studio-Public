import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const source=await readFile(new URL('../src/lib/metricRowKey.ts',import.meta.url),'utf8');
const {outputText}=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}});
const {worstKeyColumn,worstKeyValue}=await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
const col=(name,unit='unitless',numeric=true)=>({name,unit,numeric,meaning:'unknown',unitSuggested:false,meaningSuggested:false});
const ordinal={kind:'ordinal',column:null,windowSeconds:null};
test('worst row key uses declared axis ahead of a chosen locator',()=>{
  const columns=[col('other'),col('elapsed_ms','ms')],axis={kind:'elapsed',column:1,windowSeconds:null};
  assert.equal(worstKeyColumn(columns,axis,0),1);
  assert.equal(worstKeyValue({index:8,line:10,x:2.25,cells:[99,2250]},axis,1),2.25);
});
test('ordinal key defaults to first time unit or literal elapsed/time token; user can override',()=>{
  assert.equal(worstKeyColumn([col('count'),col('queue_us_p95','us'),col('elapsed_s','s')],ordinal,null),1);
  assert.equal(worstKeyColumn([col('count'),col('start_time','unitless',false)],ordinal,null),1);
  assert.equal(worstKeyColumn([col('count'),col('time'),col('elapsed_s','s')],ordinal,0),0);
  assert.equal(worstKeyColumn([col('count'),col('runtime_bytes')],ordinal,null),null);
  const row={index:2,line:4,x:3,cells:[2.25,80]};assert.equal(worstKeyValue(row,ordinal,0),2.25);assert.equal(row.index,2);assert.equal(row.x,3);
  assert.equal(worstKeyValue({...row,cells:[null]},ordinal,0),null);
});
test('wall clock key formats the declared axis without changing raw cells',()=>{
  const axis={kind:'iso8601',column:0,windowSeconds:null},row={index:0,line:2,x:0,cells:['1970-01-01T01:00:00+01:00']};
  assert.equal(worstKeyValue(row,axis,0),'1970-01-01T00:00:00.000Z');assert.equal(row.cells[0],'1970-01-01T01:00:00+01:00');
});
