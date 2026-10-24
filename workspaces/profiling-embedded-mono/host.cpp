#include <dlfcn.h>
#include <iostream>
#include <chrono>
#include <cstdint>
#include <cstdlib>
#include <unistd.h>
using Init=void*(*)(const char*,const char*);
int main(int argc,char**argv){
 if(argc!=3)return 2;
 if(getenv("CRAIDD_MONO_FIXTURE_BEFORE_INIT")){std::cout<<"BEFORE_INIT "<<getpid()<<std::endl;std::string command;std::getline(std::cin,command);}
 void* lib=dlopen(argv[1],RTLD_NOW|RTLD_GLOBAL);if(!lib){std::cerr<<dlerror();return 3;}
 auto init=reinterpret_cast<Init>(dlsym(lib,"mono_jit_init_version"));
 auto open=reinterpret_cast<void*(*)(void*,const char*)>(dlsym(lib,"mono_domain_assembly_open"));
 auto exec=reinterpret_cast<int(*)(void*,void*,int,char**)>(dlsym(lib,"mono_jit_exec"));
 auto cleanup=reinterpret_cast<void(*)(void*)>(dlsym(lib,"mono_jit_cleanup"));
 if(!init||!open||!exec||!cleanup)return 4;
 auto domain=init("embedded-fixture","v4.0.30319");if(!domain)return 5;
 auto assembly=open(domain,argv[2]);if(!assembly)return 6;
 auto image=reinterpret_cast<void*(*)(void*)>(dlsym(lib,"mono_assembly_get_image"))(assembly);
 auto klass=reinterpret_cast<void*(*)(void*,const char*,const char*)>(dlsym(lib,"mono_class_from_name"))(image,"","EmbeddedHot");
 auto method=reinterpret_cast<void*(*)(void*,const char*,int)>(dlsym(lib,"mono_class_get_method_from_name"))(klass,"KnownManagedHot",1);
 auto code=reinterpret_cast<void*(*)(void*)>(dlsym(lib,"mono_compile_method"))(method);
 auto info=reinterpret_cast<void*(*)(void*,void*)>(dlsym(lib,"mono_jit_info_table_find"))(domain,code);
 auto size=reinterpret_cast<int(*)(void*)>(dlsym(lib,"mono_jit_info_get_code_size"))(info);
 std::cout<<"HOT_RANGE "<<std::hex<<reinterpret_cast<uintptr_t>(code)<<" "<<size<<std::dec<<std::endl;
 if(getenv("CRAIDD_MONO_FIXTURE_GATE")){std::cout<<"READY"<<std::endl;std::string command;std::getline(std::cin,command);}
 auto start=std::chrono::steady_clock::now();int result=exec(domain,assembly,1,argv+2);
 std::cout<<"ELAPSED_MS "<<std::chrono::duration<double,std::milli>(std::chrono::steady_clock::now()-start).count()<<std::endl;
 if(getenv("CRAIDD_MONO_FIXTURE_GATE")){std::string command;std::getline(std::cin,command);}
 cleanup(domain);return result;
}
