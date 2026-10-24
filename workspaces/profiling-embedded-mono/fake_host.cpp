// Exercises the adapter callback without forking a live multithreaded Mono VM.
#include <dlfcn.h>
#include <cstdlib>
#include <iostream>
#include <string>
#include <thread>
#include <vector>
#include <unistd.h>
#include <sys/wait.h>
int main(int argc,char**argv){if(argc!=3)return 2;std::cout<<"BEFORE_INIT "<<getpid()<<std::endl;std::string line;std::getline(std::cin,line);void*lib=dlopen(argv[1],RTLD_NOW|RTLD_GLOBAL);if(!lib)return 3;auto init=(void*(*)(const char*,const char*))dlsym(lib,"mono_jit_init_version");if(!init||!init("test","test"))return 4;auto compile=(void(*)())dlsym(lib,"fake_compile");std::string mode=argv[2];
 if(mode=="stress"){std::vector<std::thread>threads;for(int i=0;i<32;i++)threads.emplace_back([&]{for(int n=0;n<1000;n++){if(!dlsym(RTLD_DEFAULT,"malloc"))std::abort();compile();}});for(auto&t:threads)t.join();}
 else if(mode=="cap"){for(int i=0;i<5000;i++)compile();}
 else{compile();if(mode=="fork"){pid_t child=fork();if(child==0){compile();_exit(0);}int status;waitpid(child,&status,0);if(status)return 5;std::cout<<"CHILD "<<child<<std::endl;}}
 return 0;}
