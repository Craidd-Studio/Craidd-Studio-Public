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
#include <thread>
#include <chrono>
#include <cerrno>
#include <sys/file.h>
#include <limits.h>
namespace craidd_gold {
inline unsigned long long clock_ns(clockid_t clock) { timespec t{}; clock_gettime(clock,&t); return t.tv_sec*1000000000ULL+t.tv_nsec; }
inline std::atomic<unsigned long long> next{1};
inline std::mutex transport_lock;
inline unsigned long long event_sequence=0,play_generation=0;
inline bool play_controlled=false,playing=false;
inline int socket_fd=-1;
inline unsigned long long retry_at=0,discovery_at=0;
inline pid_t owner_pid=0;
inline std::string selected_socket,connected_socket;
inline void disconnect_source() {
 std::lock_guard<std::mutex> guard(transport_lock);
 if(socket_fd>=0)close(socket_fd);
 socket_fd=-1;retry_at=0;
}
inline unsigned long long process_birth(pid_t pid) {
 char path[64];std::snprintf(path,sizeof(path),"/proc/%d/stat",pid);
 FILE* file=std::fopen(path,"r");if(!file)return 0;
 char data[8192];const bool read=std::fgets(data,sizeof(data),file)!=nullptr;std::fclose(file);if(!read)return 0;
 char* tail=std::strrchr(data,')');if(!tail)return 0;
 char* save=nullptr;char* field=strtok_r(tail+1," ",&save);
 if(!field||*field=='Z'||*field=='X')return 0;
 for(int i=0;field&&i<19;++i)field=strtok_r(nullptr," ",&save);
 return field?std::strtoull(field,nullptr,10):0;
}
inline bool private_directory(const std::string& path) {
 struct stat m{};
 return !lstat(path.c_str(),&m)&&S_ISDIR(m.st_mode)&&m.st_uid==geteuid()&&!(m.st_mode&0077);
}
inline std::string discovery_directory() {
 const char* home=std::getenv("HOME");if(!home||home[0]!='/')return {};
 const char* runtime=std::getenv("XDG_RUNTIME_DIR");
 const std::string base=runtime?runtime:std::string(home)+"/.cache/craidd-studio";
 if(base.empty()||base[0]!='/'||!private_directory(base))return {};
 const std::string root=base+"/craidd-profiling";if(!private_directory(root))return {};
 char canonical[PATH_MAX];const char* resolved=realpath(home,canonical)?canonical:home;
 const char* scope=std::getenv("CRAIDD_PROFILE_NAMESPACE");
 const bool explicit_scope=scope&&*scope;
 unsigned long long hash=0xcbf29ce484222325ULL;
 for(const unsigned char* c=reinterpret_cast<const unsigned char*>(explicit_scope?scope:resolved);*c;++c)hash=(hash^*c)*0x100000001b3ULL;
 char suffix[32];std::snprintf(suffix,sizeof(suffix),"/%c%016llx",explicit_scope?'n':'h',hash);
 const auto directory=root+suffix;
 return private_directory(directory)?directory:std::string{};
}
inline void cleanup_stale(const std::string& directory,const std::string& path,const std::string& expected,const std::string& socket,pid_t owner,unsigned long long birth) {
 const int lock_fd=open((directory+"/.lock").c_str(),O_RDWR|O_NOFOLLOW|O_CLOEXEC);if(lock_fd<0)return;
 struct stat m{};
 if(fstat(lock_fd,&m)||!S_ISREG(m.st_mode)||m.st_uid!=geteuid()||(m.st_mode&0077)||flock(lock_fd,LOCK_EX|LOCK_NB)){close(lock_fd);return;}
 const int route=open(path.c_str(),O_RDONLY|O_NOFOLLOW|O_CLOEXEC);
 char data[1025]{};const auto size=route<0?-1:read(route,data,1024);if(route>=0)close(route);
 if(size>0&&std::string(data,size)==expected&&process_birth(owner)!=birth){
  const auto owned_socket=directory+"/host-"+std::to_string(owner)+"-"+std::to_string(birth)+".sock";
  if(socket==owned_socket&&!lstat(socket.c_str(),&m)&&S_ISSOCK(m.st_mode)&&m.st_uid==geteuid())unlink(socket.c_str());
  unlink(path.c_str());
 }
 close(lock_fd);
}
inline std::string discovered_socket() {
 const auto uid=geteuid();const auto birth=process_birth(getpid());if(!birth)return {};
 const auto directory=discovery_directory();if(directory.empty())return {};
 const std::string path=directory+"/"+std::to_string(getpid())+"-"+std::to_string(birth)+".endpoint";
 struct stat metadata{};
 const int fd=open(path.c_str(),O_RDONLY|O_NOFOLLOW|O_CLOEXEC);if(fd<0)return {};
 if(fstat(fd,&metadata)||!S_ISREG(metadata.st_mode)||metadata.st_uid!=uid||(metadata.st_mode&0077)||metadata.st_size>1024){close(fd);return {};}
 char data[1025]{};const auto length=read(fd,data,1024);close(fd);if(length<=0)return {};
 const std::string original(data,length);
 char* save=nullptr;char* version=strtok_r(data,"\n",&save);char* socket=strtok_r(nullptr,"\n",&save);
 char* owner_pid=strtok_r(nullptr,"\n",&save);char* owner_birth=strtok_r(nullptr,"\n",&save);
 if(!version||std::strcmp(version,"CRAIDD_PROFILE_V1")||!socket||!owner_pid||!owner_birth)return {};
 const auto owner=pid_t(std::strtol(owner_pid,nullptr,10));
 const auto expected_birth=std::strtoull(owner_birth,nullptr,10);
 if(owner<=1||!expected_birth)return {};
 if(process_birth(owner)!=expected_birth){cleanup_stale(directory,path,original,socket,owner,expected_birth);return {};}
 return socket;
}
inline void event(const char* kind,const char* marker="",const char* name="",unsigned long long invocation=0,const void* address=nullptr,size_t bytes=0) noexcept {
 // All text must be fixed ASCII identifiers supplied by the prepared build.
 if (strpbrk(marker,"\"\\\n\r") || strpbrk(name,"\"\\\n\r")) return;
 std::lock_guard<std::mutex> guard(transport_lock);
 const auto sequence=++event_sequence;
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
 char data[1024];int n=std::snprintf(data,sizeof(data),"{\"kind\":\"%s\",\"marker\":\"%s\",\"name\":\"%s\",\"invocation\":%llu,\"thread\":%ld,\"wallNs\":%llu,\"cpuNs\":%llu,\"address\":%llu,\"bytes\":%zu,\"sequence\":%llu,\"generation\":%llu,\"playing\":%s}\n",kind,marker,name,invocation,syscall(SYS_gettid),now,clock_ns(CLOCK_THREAD_CPUTIME_ID),reinterpret_cast<unsigned long long>(address),bytes,sequence,play_generation,play_controlled?(playing?"true":"false"):"null");
 if(n<=0||n>=int(sizeof(data)))return;
 // Bounded non-blocking send. A partial event closes the stream; the host marks open captures incomplete.
 const auto sent=send(socket_fd,data,n,MSG_NOSIGNAL|MSG_DONTWAIT);
 // A wholly unsent nonblocking event does not corrupt framing. Its sequence
 // gap is reported by the next event; partial frames must close the stream.
 if(sent!=n && !(sent<0&&(errno==EAGAIN||errno==EWOULDBLOCK||errno==EINTR))){close(socket_fd);socket_fd=-1;}
}
// Play state is durable native state, repeated even while the Editor is idle.
// Constructed after the global transport mutex; joined before that mutex dies.
struct StateHeartbeat {
 std::atomic<bool> running{true};
 std::thread worker;
 StateHeartbeat():worker([this]{while(running){event("state");std::this_thread::sleep_for(std::chrono::milliseconds(250));}}){}
 ~StateHeartbeat(){running=false;if(worker.joinable())worker.join();}
};
inline void play_state(unsigned long long generation,bool active){
 {std::lock_guard<std::mutex> guard(transport_lock);play_controlled=true;play_generation=generation;playing=active;}
 static StateHeartbeat heartbeat;
 event("state");
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
