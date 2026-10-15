#include "../../../support/profiling/craidd_gold.hpp"
#include <atomic>
#include <cstdlib>
#include <cstring>
#include <mutex>
#include <thread>
#include <vector>
#include <sys/prctl.h>

namespace {
std::mutex gate;
std::vector<void*> retained;
std::vector<std::thread> workers;
std::atomic<bool> running{false};
std::atomic<int> state{0};
std::atomic<unsigned long long> live{0};
}
extern "C" {
// Test-player opt-in only; never changes host ptrace policy. Not called in Editor.
__attribute__((visibility("default"))) int craidd_probe_allow_attach(){return prctl(PR_SET_PTRACER,PR_SET_PTRACER_ANY,0,0,0);}
// Scalar, deterministic native entry: usable for attach inspection and future value LDI qualification.
__attribute__((visibility("default"),noinline)) int craidd_probe_mix(int seed,int iterations) {
    craidd_gold::solo("unity.solo","Unity native recording");
    craidd_gold::Range frame("unity.native.mix","Native scalar work");
    unsigned value=static_cast<unsigned>(seed);
    for(int i=0;i<iterations;++i) {value=(value*1664525u+1013904223u)^static_cast<unsigned>(i);}
    int result=static_cast<int>(value&0x7fffffff); // NATIVE_BREAK_HERE
    frame.finish();
    return result;
}
__attribute__((visibility("default"))) void craidd_probe_allocate(int bytes,int retain) {
    craidd_gold::Range range("unity.native.alloc","Native allocation cohort");
    if(bytes<=0||bytes>16*1024*1024)return;
    void* memory=std::malloc(static_cast<size_t>(bytes));if(!memory)return;
    std::memset(memory,0x5a,static_cast<size_t>(bytes));
    craidd_gold::allocated(memory,static_cast<size_t>(bytes));
    if(retain){std::lock_guard<std::mutex> lock(gate);retained.push_back(memory);live+=bytes;}
    else{craidd_gold::freed(memory);std::free(memory);}
    range.finish();
}
__attribute__((visibility("default"))) void craidd_probe_clear(){
    std::lock_guard<std::mutex> lock(gate);
    for(void* memory:retained){craidd_gold::freed(memory);std::free(memory);}retained.clear();live=0;
}
__attribute__((visibility("default"))) unsigned long long craidd_probe_live(){return live.load();}
// Stateful entry is intentionally separate: must never be described as value-isolated LDI.
__attribute__((visibility("default"))) int craidd_probe_stateful(int delta){return state.fetch_add(delta)+delta;}
__attribute__((visibility("default"))) void craidd_probe_workers_start(){
    if(running.exchange(true))return;
    for(int n=0;n<2;++n)workers.emplace_back([n]{while(running){craidd_probe_mix(n+1,20000);std::this_thread::sleep_for(std::chrono::milliseconds(40));}});
}
__attribute__((visibility("default"))) void craidd_probe_workers_stop(){running=false;for(auto& worker:workers)if(worker.joinable())worker.join();workers.clear();}
__attribute__((visibility("default"))) void craidd_probe_play_end(){craidd_gold::play_end();}
}
