"""Find only the requested process's named X11 window; never return other titles."""
import ctypes as C,ctypes.util,json,sys
x=C.CDLL(ctypes.util.find_library('X11'));W=C.c_ulong;P=C.c_void_p
x.XOpenDisplay.argtypes=[C.c_char_p];x.XOpenDisplay.restype=P
x.XDefaultRootWindow.argtypes=[P];x.XDefaultRootWindow.restype=W
x.XInternAtom.argtypes=[P,C.c_char_p,C.c_int];x.XInternAtom.restype=W
x.XQueryTree.argtypes=[P,W,C.POINTER(W),C.POINTER(W),C.POINTER(C.POINTER(W)),C.POINTER(C.c_uint)]
x.XGetWindowProperty.argtypes=[P,W,W,C.c_long,C.c_long,C.c_int,W,C.POINTER(W),C.POINTER(C.c_int),C.POINTER(W),C.POINTER(W),C.POINTER(P)]
x.XFetchName.argtypes=[P,W,C.POINTER(P)];x.XFree.argtypes=[P]
x.XCloseDisplay.argtypes=[P]
d=x.XOpenDisplay(None)
if not d:raise SystemExit('No authorized X11 display connection')
pid=int(sys.argv[1]);needle=sys.argv[2]
def prop(window,key,length=1):
 atom=x.XInternAtom(d,key.encode(),0);actual=W();fmt=C.c_int();n=W();after=W();data=P()
 status=x.XGetWindowProperty(d,window,atom,0,length,0,0,C.byref(actual),C.byref(fmt),C.byref(n),C.byref(after),C.byref(data))
 result=None
 if status==0 and data:
  if fmt.value==32 and n.value:result=int(C.cast(data,C.POINTER(W))[0])
  elif fmt.value==8:result=C.string_at(data,n.value).decode(errors='replace')
  x.XFree(data)
 return result
queue=[(x.XDefaultRootWindow(d),0)];found=[];owned=[];seen=set()
while queue and len(seen)<2000:
 window,depth=queue.pop(0)
 if window in seen:continue
 seen.add(window);owner=prop(window,'_NET_WM_PID');leader=prop(window,'WM_CLIENT_LEADER')
 if owner!=pid and isinstance(leader,int):owner=prop(leader,'_NET_WM_PID')
 if owner==pid:
  title=prop(window,'_NET_WM_NAME',4096)
  if not isinstance(title,str):
   name=P()
   if x.XFetchName(d,window,C.byref(name)) and name:title=C.string_at(name).decode(errors='replace');x.XFree(name)
  if isinstance(title,str):
   owned.append({'windowId':window,'title':title})
   if needle==title:found.append({'windowId':window,'pid':owner,'clientLeader':leader,'title':title})
 if depth<4:
  root=W();parent=W();children=C.POINTER(W)();count=C.c_uint()
  if x.XQueryTree(d,window,C.byref(root),C.byref(parent),C.byref(children),C.byref(count)):
   queue.extend((children[i],depth+1) for i in range(min(count.value,500)))
   if children:x.XFree(children)
x.XCloseDisplay(d)
if len(found)!=1:raise SystemExit('Expected one task-owned named window, found '+str(len(found))+'; owned windows: '+json.dumps(owned))
print(json.dumps(found[0]))
