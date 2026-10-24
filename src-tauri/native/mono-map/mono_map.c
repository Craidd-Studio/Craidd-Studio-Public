#define _GNU_SOURCE
/* Craidd adapter v1.0.0. Supported: dynamic dlsym(mono_jit_init_version),
 * Linux x86_64 GNU. Never changes runtime options or an existing map. */
#include <dlfcn.h>
#include <errno.h>
#include <fcntl.h>
#include <inttypes.h>
#include <pthread.h>
#include <stdatomic.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>
#define MAP_LIMIT (16u*1024u*1024u)
#define NAME_LIMIT 4096u
static _Atomic(int) diagnosed;
static void note(const char *reason) {
 if(atomic_exchange(&diagnosed,1))return;
 char line[240];int n=snprintf(line,sizeof(line),"[Craidd Mono map v1.0.0] unavailable: %s\n",reason);
 if(n>0){size_t length=(size_t)n<sizeof(line)?(size_t)n:sizeof(line)-1;ssize_t ignored=write(STDERR_FILENO,line,length);(void)ignored;}
}
typedef void*(*symbol_fn)(void*,const char*);
typedef void*(*init_fn)(const char*,const char*);
static _Atomic(symbol_fn) next_symbol;
static init_fn original_init;
static void *runtime_handle;
static pthread_mutex_t init_lock=PTHREAD_MUTEX_INITIALIZER;
static pthread_once_t profiler_once=PTHREAD_ONCE_INIT;
static pthread_mutex_t map_lock=PTHREAD_MUTEX_INITIALIZER;
static int map_fd=-1,disabled;
static pid_t map_pid;
static size_t bytes_written;
static _Thread_local int in_callback;
static void*(*code_start)(void*);
static int(*code_size)(void*);
static char*(*method_name)(void*,int);
static void(*mono_release)(void*);
static void jit_done(void *profiler,void *method,void *info) {
 (void)profiler;
 if(!method||!info||in_callback||getpid()!=map_pid)return;
 in_callback=1;
 char *name=method_name(method,1);
 if(name){
  size_t length=strnlen(name,NAME_LIMIT+1);
  int size=code_size(info);void *start=code_start(info);
  if(length<=NAME_LIMIT&&size>0&&start){
   for(size_t i=0;i<length;i++)if((unsigned char)name[i]<32||(unsigned char)name[i]==127)name[i]=' ';
   char line[NAME_LIMIT+96];int n=snprintf(line,sizeof(line),"%" PRIxPTR " %x %s\n",(uintptr_t)start,(unsigned)size,name);
   pthread_mutex_lock(&map_lock);
   if(!disabled&&n>0&&(size_t)n<sizeof(line)){
    if(bytes_written+(size_t)n>MAP_LIMIT){disabled=1;note("16 MiB map limit reached; later methods remain unnamed");}
    else{size_t done=0;while(done<(size_t)n){ssize_t amount=write(map_fd,line+done,(size_t)n-done);if(amount<0&&errno==EINTR)continue;if(amount<=0){disabled=1;note("map write failed; later methods remain unnamed");break;}done+=(size_t)amount;}bytes_written+=done;}
   }
   pthread_mutex_unlock(&map_lock);
  }
  mono_release(name);
 }
 in_callback=0;
}
static void register_profiler(void) {
 symbol_fn symbol=atomic_load(&next_symbol);
 void*(*create)(void*)=(void*(*)(void*))symbol(runtime_handle,"mono_profiler_create");
 void(*set_done)(void*,void(*)(void*,void*,void*))=(void(*)(void*,void(*)(void*,void*,void*)))symbol(runtime_handle,"mono_profiler_set_jit_done_callback");
 code_start=(void*(*)(void*))symbol(runtime_handle,"mono_jit_info_get_code_start");
 code_size=(int(*)(void*))symbol(runtime_handle,"mono_jit_info_get_code_size");
 method_name=(char*(*)(void*,int))symbol(runtime_handle,"mono_method_full_name");
 mono_release=(void(*)(void*))symbol(runtime_handle,"mono_free");
#ifdef CRAIDD_TEST_MISSING_EXPORT
 code_start=0;
#endif
 if(!create||!set_done||!code_start||!code_size||!method_name||!mono_release){note("required runtime export missing");return;}
 if(getuid()!=geteuid()||getgid()!=getegid()){note("changed process credentials");return;}
 char path[80];snprintf(path,sizeof(path),"/tmp/perf-%ld.map",(long)getpid());
 map_pid=getpid();
 map_fd=open(path,O_WRONLY|O_CREAT|O_EXCL|O_APPEND|O_NOFOLLOW|O_CLOEXEC,0600);
 struct stat st;
 if(map_fd<0){note("map already exists or cannot be created");return;}
 if(fstat(map_fd,&st)||!S_ISREG(st.st_mode)||st.st_uid!=geteuid()||st.st_nlink!=1||fchmod(map_fd,0600)){
  close(map_fd);map_fd=-1;note("map ownership or permissions refused");return;
 }
 void *profiler=create(0);
 if(!profiler){close(map_fd);map_fd=-1;note("profiler registration failed");return;}
 set_done(profiler,jit_done);
}
static void *init_wrapper(const char *name,const char *version) {
 void *domain=original_init(name,version);
 if(domain)pthread_once(&profiler_once,register_profiler);
 return domain;
}
__attribute__((visibility("default"))) void *dlsym(void *handle,const char *name) {
 symbol_fn symbol=atomic_load(&next_symbol);
 if(!symbol){symbol=(symbol_fn)dlvsym(RTLD_NEXT,"dlsym","GLIBC_2.2.5");if(!symbol){note("unsupported dynamic-loader ABI");return 0;}atomic_store(&next_symbol,symbol);}
 void *value=symbol(handle,name);
 if(value&&strcmp(name,"mono_jit_init_version")==0){
  pthread_mutex_lock(&init_lock);
  if(original_init&&original_init!=(init_fn)value){pthread_mutex_unlock(&init_lock);note("multiple runtime initialization exports unsupported");return value;}
  if(!original_init){original_init=(init_fn)value;runtime_handle=handle;}
  pthread_mutex_unlock(&init_lock);
  return (void*)init_wrapper;
 }
 return value;
}
