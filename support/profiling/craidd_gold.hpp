#pragma once
// Prepared, opt-in Linux source provider. No breakpoints, process signals or global alloc hooks.
#include <atomic>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <mutex>
#include <type_traits>
#include <sys/socket.h>
#include <sys/un.h>
#include <sys/syscall.h>
#include <time.h>
#include <unistd.h>
namespace craidd_gold {
inline unsigned long long clock_ns(clockid_t clock) { timespec t{}; clock_gettime(clock,&t); return t.tv_sec*1000000000ULL+t.tv_nsec; }
inline std::atomic<unsigned long long> next{1};
inline void event(const char* kind,const char* marker="",const char* name="",unsigned long long invocation=0,const void* address=nullptr,size_t bytes=0) noexcept {
 // All text must be fixed ASCII identifiers supplied by the prepared build.
 if (strpbrk(marker,"\"\\\n\r") || strpbrk(name,"\"\\\n\r")) return;
 static std::mutex lock; std::lock_guard<std::mutex> guard(lock);
 static int socket_fd=-1; static unsigned long long retry_at=0; static pid_t owner_pid=0;
 const pid_t current_pid=getpid();if(owner_pid!=current_pid){if(socket_fd>=0)close(socket_fd);socket_fd=-1;retry_at=0;owner_pid=current_pid;}
 const auto now=clock_ns(CLOCK_MONOTONIC);
 if(socket_fd<0){if(now<retry_at)return;retry_at=now+1000000000ULL;
  const char* path=std::getenv("CRAIDD_PROFILE_SOCKET");if(!path||strlen(path)>=sizeof(sockaddr_un::sun_path))return;
  int fd=socket(AF_UNIX,SOCK_STREAM|SOCK_CLOEXEC,0);if(fd<0)return;
  sockaddr_un a{};a.sun_family=AF_UNIX;std::strcpy(a.sun_path,path);
  if(connect(fd,reinterpret_cast<sockaddr*>(&a),sizeof(a))!=0){close(fd);return;}socket_fd=fd;
 }
 char data[1024];int n=std::snprintf(data,sizeof(data),"{\"kind\":\"%s\",\"marker\":\"%s\",\"name\":\"%s\",\"invocation\":%llu,\"thread\":%ld,\"wallNs\":%llu,\"cpuNs\":%llu,\"address\":%llu,\"bytes\":%zu}\n",kind,marker,name,invocation,syscall(SYS_gettid),now,clock_ns(CLOCK_THREAD_CPUTIME_ID),reinterpret_cast<unsigned long long>(address),bytes);
 if(n<=0||n>=int(sizeof(data)))return;
 // Bounded non-blocking send. A partial event closes the stream; the host marks open captures incomplete.
 if(send(socket_fd,data,n,MSG_NOSIGNAL|MSG_DONTWAIT)!=n){close(socket_fd);socket_fd=-1;}
}
struct Range {
 const char* id;const char* name;unsigned long long invocation;bool active;
 Range(const char* marker,const char* label,bool condition=true):id(marker),name(label),invocation(next.fetch_add(1)),active(condition){if(active)event("begin",id,name,invocation);}
 Range(const Range&)=delete;Range& operator=(const Range&)=delete;
 void finish()noexcept{if(active){event("end",id,name,invocation);active=false;}}
 ~Range(){if(active)event("unwind",id,name,invocation);}
};
inline void solo(const char* id,const char* name,bool condition=true){if(condition)event("solo",id,name);}
inline void allocated(const void* address,size_t bytes){event("alloc","","",0,address,bytes);}
inline void freed(const void* address){event("free","","",0,address);}
inline void play_end(){event("play-end");}
}

// Explicit opt-in source anchors used only by the prepared-copy exporter.
#ifndef CRAIDD_GOLD_START
#define CRAIDD_GOLD_START() do {} while(false)
#define CRAIDD_GOLD_END() do {} while(false)
#define CRAIDD_GOLD_SOLO() do {} while(false)
#endif
