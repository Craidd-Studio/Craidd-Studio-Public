export async function showProfiler(app) {
  await app.wd.click(await app.wd.find("//button[@role='tab' and normalize-space()='Profiler']"));
  await app.waitFor("Profiler visible", async () => ({ done: await app.wd.execute("return !!document.querySelector('.profiler-toolbar')") }));
}
export async function visibleIcons(app) {
  return app.wd.execute(`return [...document.querySelectorAll('.profiler-toolbar button[aria-label]')].map(b => {
    const svg=b.querySelector('svg');const r=svg?.getBoundingClientRect();
    return { label:b.getAttribute('aria-label'), width:r?.width??0,height:r?.height??0,
      path:svg?.querySelector('path')?.getAttribute('d'),stroke:svg?getComputedStyle(svg).stroke:null,
      iconFont:!!b.querySelector('.codicon') };
  });`);
}

export async function resizeProfiler(app, width) {
  await app.wd.execute("window.__profilerResizeEvents=[]; if(!window.__profilerResizeListening){window.__profilerResizeListening=true;for(const type of ['pointerdown','pointermove','pointerup'])document.addEventListener(type,e=>{window.__profilerResizeEvents.push({type:e.type,x:e.clientX,y:e.clientY,buttons:e.buttons});window.__profilerResizeEvents=window.__profilerResizeEvents.slice(-20)},true)}");
  const handle=await app.wd.execute("const box=document.querySelector('.profiler-source-host').parentElement.parentElement;const r=box.previousElementSibling.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+Math.min(100,r.height/2),width:box.getBoundingClientRect().width};");
  await app.wd.command('POST','/actions',{actions:[{type:'pointer',id:'mouse',parameters:{pointerType:'mouse'},actions:[
    {type:'pointerMove',duration:50,origin:'viewport',x:Math.round(handle.x),y:Math.round(handle.y)},
    {type:'pause',duration:50},
    {type:'pointerDown',button:0},
    {type:'pause',duration:50},
    {type:'pointerMove',duration:180,origin:'viewport',x:Math.round(handle.x+handle.width-width),y:Math.round(handle.y)},
    {type:'pointerUp',button:0},
  ]}]});
  const observed=await app.wd.execute('return {width:document.querySelector(".profiler-source-host").parentElement.parentElement.getBoundingClientRect().width,events:window.__profilerResizeEvents}');
  app.record('resize-pointer',{requested:width,before:handle,after:observed});
  await app.waitFor('panel width '+width,async()=>({done:await app.wd.execute('return Math.abs(document.querySelector(".profiler-source-host").parentElement.parentElement.getBoundingClientRect().width-arguments[0])<2',[width]),value:observed}));
  return app.wd.execute("const p=document.querySelector('.profiler-panel'),r=document.querySelector('.profiler-results');return {width:p.getBoundingClientRect().width,clientWidth:r.clientWidth,scrollWidth:r.scrollWidth,viewport:{width:innerWidth,height:innerHeight,dpr:devicePixelRatio}};");
}

