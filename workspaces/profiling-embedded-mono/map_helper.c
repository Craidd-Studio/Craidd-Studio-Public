#define _GNU_SOURCE
// Qualification prototype only. Not linked, shipped or activated by Craidd.
#include <dlfcn.h>
#include <fcntl.h>
#include <pthread.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>
#include <stdint.h>
static void* (*real_dlsym)(void*,const char*);
static void* (*real_init)(const char*,const char*);
static void* runtime;
static int fd=-1,diagnosed=0;
static pthread_mutex_t lock=PTHREAD_MUTEX_INITIALIZER;
static void*(*code_start)(void*);static int(*code_size)(void*);static char*(*method_name)(void*,int);static void(*mono_release)(void*);
static void diagnostic(void){if(!diagnosed){diagnosed=1;fputs("[craidd fixture] Mono map helper unavailable; required export missing or map refused\n",stderr);}}
static void jit_done(void* profiler,void* method,void* info){
 (void)profiler;char* name=method_name(method,1);if(!name)return;
 for(char* p=name;*p;p++)if(*p=='\n'||*p=='\r')*p=' ';
 int size=code_size(info);void* start=code_start(info);
 if(size>0&&start){pthread_mutex_lock(&lock);dprintf(fd,"%lx %x %s\n",(unsigned long)(uintptr_t)start,size,name);pthread_mutex_unlock(&lock);}
 mono_release(name);
}
static void register_map(void){
 void*(*create)(void*)=real_dlsym(runtime,"mono_profiler_create");
 void(*set_done)(void*,void(*)(void*,void*,void*))=real_dlsym(runtime,"mono_profiler_set_jit_done_callback");
 code_start=real_dlsym(runtime,"mono_jit_info_get_code_start");code_size=real_dlsym(runtime,"mono_jit_info_get_code_size");
 method_name=real_dlsym(runtime,"mono_method_full_name");mono_release=real_dlsym(runtime,"mono_free");
#ifdef FORCE_MISSING_EXPORT
 code_start=0;
#endif
 if(!create||!set_done||!code_start||!code_size||!method_name||!mono_release){diagnostic();return;}
 char path[80];snprintf(path,sizeof(path),"/tmp/perf-%d.map",getpid());
 fd=open(path,O_WRONLY|O_CREAT|O_EXCL|O_APPEND|O_NOFOLLOW|O_CLOEXEC,0600);
 struct stat st;if(fd<0||fstat(fd,&st)||!S_ISREG(st.st_mode)||st.st_uid!=getuid()||(st.st_mode&077)){if(fd>=0)close(fd);fd=-1;diagnostic();return;}
 void* profiler=create(0);if(!profiler){close(fd);fd=-1;diagnostic();return;}
 set_done(profiler,jit_done);
}
static void* init_wrapper(const char* name,const char* version){void* domain=real_init(name,version);if(domain)register_map();return domain;}
void* dlsym(void* handle,const char* name){
 if(!real_dlsym)real_dlsym=dlvsym(RTLD_NEXT,"dlsym","GLIBC_2.2.5");
 if(!real_dlsym)return 0;
 void* value=real_dlsym(handle,name);
 if(value&&strcmp(name,"mono_jit_init_version")==0){runtime=handle;real_init=value;return init_wrapper;}
 return value;
}
