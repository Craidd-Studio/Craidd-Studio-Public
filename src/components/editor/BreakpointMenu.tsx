import { useGold } from "../../store/goldStore";
import { useState } from "react";
import { useBreakpoints } from "../../store/breakpointStore";
import { useLinkedWindows } from "../../store/linkedWindowsStore";
import { removeLdiBlue, setLdiBlue, setupLdiBlue, useLdi } from "../../store/ldiStore";
import type { LdiCallSite } from "../../store/ldiStore";

export default function BreakpointMenu({ file, line, x, y, callSite, onClose }: {
  file: string; line: number; x: number; y: number; callSite?: LdiCallSite; onClose: () => void;
}) {
  const red = useBreakpoints((state) => state.points.find((point) => point.file === file && point.line === line));
  const active = !!red;
  const gold = useGold(s => s.points);
  const atGold = gold.find(p => p.file === file && (p.start === line || p.end === line));
  const pendingGold = gold.filter(p => p.file === file && !p.solo && p.end === null && p.start < line);
  const goldEdit = (operation: "start"|"end"|"solo"|"remove"|"condition", id?:string, value?:string) => { void useGold.getState().edit(operation,file,line,id,value).then(onClose).catch(e=>setMenuError(String(e))); };
  const linked = useLinkedWindows();
  const blue = useLdi((state) => state.blues.find((point) => point.file === file && point.line === line && point.originLabel === linked.ownWindowLabel));
  const partners = linked.windows.filter((item) => item.ldiRole === "native-library"
    && (callSite?.partnerLabels.includes(item.windowLabel)
      || (item.selectedConfigName !== null && callSite?.configNames.includes(item.selectedConfigName))));
  const [editingCondition, setEditingCondition] = useState<"red" | "blue" | "gold" | null>(null);
  const [condition, setCondition] = useState("");
  const [menuError, setMenuError] = useState<string | null>(null);
  const saveCondition = () => {
    if (editingCondition === "gold" && atGold) { goldEdit("condition",atGold.id,condition); return; }
    const save = editingCondition === "blue" && blue
      ? setLdiBlue(file, line, blue.partnerLabel, condition)
      : editingCondition === "red" && red
        ? useBreakpoints.getState().setCondition(file, line, condition)
        : Promise.reject(new Error("Breakpoint no longer exists"));
    void save
      .then(onClose)
      .catch((error) => setMenuError(String(error)));
  };
  const toggle = () => {
    void useBreakpoints.getState().toggle(file, line)
      .then(onClose)
      .catch((error) => setMenuError(String(error)));
  };
  return <>
    <button className="fixed inset-0 z-40 cursor-default" aria-label="Close breakpoint menu" onClick={onClose} />
    <div role="menu" className="fixed z-50 min-w-44 max-h-[min(24rem,calc(100vh-1rem))] overflow-y-auto bg-zinc-900 border border-zinc-700 rounded shadow-2xl py-1 text-xs"
      style={{ left: Math.max(4, Math.min(x, window.innerWidth - 300)), top: Math.max(4, Math.min(y, window.innerHeight - (editingCondition ? 240 : 160))) }}>
      <button role="menuitem" className="block w-full px-3 py-1.5 text-left text-zinc-200 hover:bg-blue-700 hover:text-white"
        onClick={toggle}>{active ? "Remove Red Breakpoint" : "Set Red Breakpoint"}</button>
      {red && <button role="menuitem" className="block w-full px-3 py-1.5 text-left text-red-300 hover:bg-red-900"
        onClick={() => { setCondition(red.condition ?? ""); setEditingCondition("red"); }}>
        {red.condition ? "Edit red condition…" : "Set red condition…"}</button>}
      {blue?.unreachable && <div className="max-w-64 px-3 py-2 text-amber-300">
        Unreachable under this Power Config: {blue.unreachable}. Blue remains at this call site.
      </div>}
      {blue?.warning && <div className="max-w-64 px-3 py-2 text-sky-300">
        Needs recheck: {blue.warning}. Blue remains at this call site.
      </div>}
      {blue ? <button role="menuitem"
        className="block w-full px-3 py-1.5 text-left text-blue-300 hover:bg-blue-900"
        onClick={() => { void removeLdiBlue(file, line).then(onClose).catch((error) => setMenuError(String(error))); }}>
        Remove Blue Breakpoint</button>
        : null}
      {partners.filter((partner) => partner.windowLabel !== blue?.partnerLabel).map((partner) => <button key={partner.windowLabel} role="menuitem"
          title={`${file.endsWith(".rs") ? "Rust Gold Debug · shared Native view" : "Gold Linked Debug"} · ${callSite?.entryPoint ?? "native call"}`}
          className="block w-full px-3 py-1.5 text-left text-blue-300 hover:bg-blue-900"
          onClick={() => { void setLdiBlue(file, line, partner.windowLabel).then(onClose).catch((error) => setMenuError(String(error))); }}>
          {blue ? "Use Native partner" : "Set Native Debugging Breakpoint"} → CS{partner.windowId}: {partner.selectedConfigName ?? partner.projectName}</button>)}
      {(callSite?.configNames ?? []).filter((name) => !partners.some((partner) => partner.selectedConfigName === name))
        .map((name) => <button key={name} role="menuitem"
          title={`Open Native Power Config ${name} and set Blue`}
          className="block w-full px-3 py-1.5 text-left text-blue-300 hover:bg-blue-900"
          onClick={() => { void setupLdiBlue(file, line, name, !red && partners.length === 0).then(onClose).catch((error) => setMenuError(String(error))); }}>
          {blue ? "Use Native Power Config" : "Set Blue Breakpoint"} → Open {name}</button>)}
      {blue && blue.mode !== "live-native" && <button role="menuitem" className="block w-full px-3 py-1.5 text-left text-blue-300 hover:bg-blue-900"
        onClick={() => { setCondition(blue.condition ?? ""); setEditingCondition("blue"); }}>
        {blue.condition ? "Edit blue condition…" : "Set blue condition…"}</button>}
      <details className="border-t border-zinc-700 mt-1 text-amber-200">
        <summary className="px-3 py-1.5 cursor-pointer hover:bg-zinc-800">Profiling</summary>
        <p className="px-3 py-1 text-zinc-500 max-w-64">Gold records without pausing. Requires a prepared source provider.</p>
        {atGold ? <>
          {atGold.start === line && <button role="menuitem" className="block w-full px-3 py-1.5 text-left hover:bg-zinc-800" onClick={()=>{setCondition(atGold.condition);setEditingCondition("gold");}}>Add / edit Gold condition…</button>}
          <button role="menuitem" className="block w-full px-3 py-1.5 text-left hover:bg-zinc-800" onClick={()=>goldEdit("remove",atGold.id)}>Remove {atGold.solo?"Solo":atGold.end?"Gold pair (Start + End)":"awaiting Start"}</button>
        </> : <>
          <button role="menuitem" className="block w-full px-3 py-1.5 text-left hover:bg-zinc-800" onClick={()=>goldEdit("start")}>◆ Start range</button>
          {pendingGold.map(p=><button key={p.id} role="menuitem" className="block w-full px-3 py-1.5 text-left hover:bg-zinc-800" onClick={()=>goldEdit("end",p.id)}>◇ End range from line {p.start}</button>)}
          {!pendingGold.length&&<p className="px-3 py-1.5 text-zinc-500">◇ End · place a Start first</p>}
          <button role="menuitem" className="block w-full px-3 py-1.5 text-left hover:bg-zinc-800" onClick={()=>goldEdit("solo")}>◆ {gold.some(p=>p.solo)?"Move Solo here":"Solo · record until session ends"}</button>
        </>}
      </details>
      {editingCondition && <div className="px-3 py-2 space-y-2 text-zinc-200">
        <label className="block" htmlFor="breakpoint-condition">{editingCondition === "red" ? "Red" : editingCondition === "gold" ? "Gold scalar" : "Blue"} condition (blank: every hit)</label>
        <input id="breakpoint-condition" autoFocus value={condition} maxLength={256}
          onChange={(event) => setCondition(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter") saveCondition(); if (event.key === "Escape") onClose(); }}
          className="w-full rounded border border-zinc-600 bg-zinc-950 px-2 py-1 text-zinc-100" />
        {red && blue && <p className="max-w-64 text-amber-300">{blue.mode === "live-native" ? "Red remains an ordinary Rust call-site breakpoint; Native blue inspects the same process in C++." : "Blue owns this line during Gold Debug; red's condition applies in White Debug."}</p>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-2 py-1">Cancel</button>
          <button onClick={saveCondition} className="rounded bg-blue-700 px-2 py-1">Save</button>
        </div>
      </div>}
      {menuError && <div role="alert" className="max-w-72 px-3 py-2 text-amber-300 break-words">{menuError}</div>}
    </div>
  </>;
}
