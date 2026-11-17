/* Callback lifecycle fault fixture; never represents Mono naming qualification. */
#include <stdlib.h>
#include <string.h>
static void(*callback)(void*,void*,void*);
void*mono_jit_init_version(const char*a,const char*b){(void)a;(void)b;return (void*)1;}
void*mono_profiler_create(void*p){(void)p;return (void*)1;}
void mono_profiler_set_jit_done_callback(void*p,void(*c)(void*,void*,void*)){(void)p;callback=c;}
void*mono_jit_info_get_code_start(void*p){(void)p;return (void*)0x12340000;}
int mono_jit_info_get_code_size(void*p){(void)p;return 64;}
char*mono_method_full_name(void*p,int signature){(void)p;(void)signature;char*name=malloc(4097);size_t n=getenv("FAKE_LONG_NAME")?4096:24;memset(name,'n',n);name[n]=0;return name;}
void mono_free(void*p){free(p);}
void fake_compile(void){if(callback)callback((void*)1,(void*)1,(void*)1);}
