// Native qualification only: FP main calling a runtime-loaded no-FP library.
// All requested workers stay busy; stdin "stop" is normal shutdown.
#include <atomic>
#include <cstdint>
#include <cstdlib>
#include <dlfcn.h>
#include <iostream>
#include <mutex>
#include <pthread.h>
#include <string>
#include <sys/syscall.h>
#include <thread>
#include <unistd.h>
#include <vector>

using Workload = std::uint64_t (*)(std::uint64_t);
static std::atomic<bool> running{true}, ready{false};
static std::mutex output;

extern "C" __attribute__((noinline, noipa)) void native_worker_parent(Workload workload, unsigned index) {
    volatile std::uint64_t frame[2] = {index + 1, index + 2};
    std::uint64_t value = frame[0], iterations = 0;
    while (!ready.load(std::memory_order_acquire)) std::this_thread::yield();
    while (running.load(std::memory_order_relaxed)) {
        value = workload(value);
        ++iterations;
    }
    std::lock_guard<std::mutex> lock(output);
    std::cout << "COUNT " << syscall(SYS_gettid) << " " << iterations << " " << value << std::endl;
}

int main(int argc, char** argv) {
    if (argc != 3) { std::cerr << "usage: fixture LIBRARY WORKERS\n"; return 2; }
    const unsigned count = static_cast<unsigned>(std::strtoul(argv[2], nullptr, 10));
    if (count < 1 || count > 32) return 2;
    void* library = dlopen(argv[1], RTLD_NOW | RTLD_LOCAL);
    if (!library) { std::cerr << dlerror() << std::endl; return 2; }
    auto workload = reinterpret_cast<Workload>(dlsym(library, "generated_workload_entry"));
    if (!workload) { std::cerr << dlerror() << std::endl; return 2; }
    std::cout << "TARGET " << getpid() << " LIBRARY " << argv[1] << " WORKERS " << count << std::endl;
    std::vector<std::thread> workers;
    for (unsigned index = 0; index < count; ++index) workers.emplace_back([=] {
        pthread_setname_np(pthread_self(), "busy-worker");
        {
            std::lock_guard<std::mutex> lock(output);
            std::cout << "THREAD busy-worker " << syscall(SYS_gettid) << " " << index << std::endl;
        }
        native_worker_parent(workload, index);
    });
    ready.store(true, std::memory_order_release);
    { std::lock_guard<std::mutex> lock(output); std::cout << "READY" << std::endl; }
    std::string command;
    while (std::getline(std::cin, command) && command != "stop") {}
    running.store(false);
    for (auto& thread : workers) thread.join();
    dlclose(library);
    std::cout << "STOPPED" << std::endl;
}
