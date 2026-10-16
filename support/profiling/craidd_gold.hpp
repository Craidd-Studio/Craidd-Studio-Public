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
#include <sys/stat.h>
#include <fcntl.h>
#include <string>
namespace craidd_gold {
inline unsigned long long clock_ns(clockid_t clock) { timespec t{}; clock_gettime(clock,&t); return t.tv_sec*1000000000ULL+t.tv_nsec; }
inline std::atomic<unsigned long long> next{1};
inline unsigned long long process_birth(pid_t pid) {
 char path[64];std::snprintf(path,sizeof(path),"/proc/%d/stat",pid);
 FILE* file=std::fopen(path,"r");if(!file)return 0;
 char data[8192];const bool read=std::fgets(data,sizeof(data),file)!=nullptr;std::fclose(file);if(!read)return 0;
 char* tail=std::strrchr(data,')');if(!tail)return 0;
 char* save=nullptr;char* field=strtok_r(tail+1," ",&save);
 for(int i=0;field&&i<19;++i)field=strtok_r(nullptr," ",&save);
 return field?std::strtoull(field,nullptr,10):0;
}
inline std::string discovered_socket() {
 const auto uid=geteuid();const auto birth=process_birth(getpid());if(!birth)return {};
 char directory[128];std::snprintf(directory,sizeof(directory),"/run/user/%u/craidd-profiling",unsigned(uid));
 struct stat metadata{};
 if(lstat(directory,&metadata)||!S_ISDIR(metadata.st_mode)||metadata.st_uid!=uid||(metadata.st_mode&0077))return {};
 const std::string path=std::string(directory)+"/"+std::to_string(getpid())+"-"+std::to_string(birth)+".endpoint";
 const int fd=open(path.c_str(),O_RDONLY|O_NOFOLLOW|O_CLOEXEC);if(fd<0)return {};
 if(fstat(fd,&metadata)||!S_ISREG(metadata.st_mode)||metadata.st_uid!=uid||(metadata.st_mode&0077)||metadata.st_size>1024){close(fd);return {};}
 char data[1025]{};const auto length=read(fd,data,1024);close(fd);if(length<=0)return {};
 char* save=nullptr;char* version=strtok_r(data,"\n",&save);char* socket=strtok_r(nullptr,"\n",&save);
 char* owner_pid=strtok_r(nullptr,"\n",&save);char* owner_birth=strtok_r(nullptr,"\n",&save);
 if(!version||std::strcmp(version,"CRAIDD_PROFILE_V1")||!socket||!owner_pid||!owner_birth)return {};
 const auto owner=pid_t(std::strtol(owner_pid,nullptr,10));
 const auto expected_birth=std::strtoull(owner_birth,nullptr,10);
 if(owner<=1||!expected_birth||process_birth(owner)!=expected_birth)return {};
 return socket;
}
inline void event(const char* kind,const char* marker="",const char* name="",unsigned long long invocation=0,const void* address=nullptr,size_t bytes=0) noexcept {
 // All text must be fixed ASCII identifiers supplied by the prepared build.
 if (strpbrk(marker,"\"\\\n\r") || strpbrk(name,"\"\\\n\r")) return;
 static std::mutex lock; std::lock_guard<std::mutex> guard(lock);
 static int socket_fd=-1; static unsigned long long retry_at=0; static pid_t owner_pid=0;
 static unsigned long long discovery_at=0; static std::string selected_socket,connected_socket;
 const pid_t current_pid=getpid();if(owner_pid!=current_pid){if(socket_fd>=0)close(socket_fd);socket_fd=-1;retry_at=0;discovery_at=0;selected_socket.clear();connected_socket.clear();owner_pid=current_pid;}
 const auto now=clock_ns(CLOCK_MONOTONIC);
 if(now>=discovery_at){
  discovery_at=now+1000000000ULL;selected_socket=discovered_socket();
  if(selected_socket.empty()){const char* legacy=std::getenv("CRAIDD_PROFILE_SOCKET");if(legacy)selected_socket=legacy;}
  if(socket_fd>=0&&connected_socket!=selected_socket){close(socket_fd);socket_fd=-1;retry_at=0;}
 }
 if(socket_fd<0){if(now<retry_at)return;retry_at=now+1000000000ULL;
  const char* path=selected_socket.c_str();if(selected_socket.empty()||strlen(path)>=sizeof(sockaddr_un::sun_path))return;
  int fd=socket(AF_UNIX,SOCK_STREAM|SOCK_CLOEXEC,0);if(fd<0)return;
  sockaddr_un a{};a.sun_family=AF_UNIX;std::strcpy(a.sun_path,path);
  if(connect(fd,reinterpret_cast<sockaddr*>(&a),sizeof(a))!=0){close(fd);return;}
  ucred peer{};socklen_t peer_size=sizeof(peer);if(getsockopt(fd,SOL_SOCKET,SO_PEERCRED,&peer,&peer_size)||peer.uid!=geteuid()){close(fd);return;}
  socket_fd=fd;connected_socket=selected_socket;
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
