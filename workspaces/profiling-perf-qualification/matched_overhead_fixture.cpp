// Separate overhead-only harness; existing measured fixtures stay unchanged.
// Counters advance once per completed generated workload, not per inner loop.
#include <atomic>
#include <cstdint>
#include <cstdlib>
#include <dlfcn.h>
#include <iostream>
#include <memory>
#include <mutex>
#include <pthread.h>
#include <string>
#include <sys/syscall.h>
#include <thread>
#include <time.h>
#include <unistd.h>
#include <vector>

using Workload = std::uint64_t (*)(std::uint64_t);
struct alignas(64) Counter { std::atomic<std::uint64_t> completed{0}; };
static_assert(std::atomic<std::uint64_t>::is_always_lock_free);
static std::atomic<bool> running{true}, ready{false};
static std::atomic<unsigned> reported{0};
static std::mutex output;
static std::unique_ptr<Counter[]> counters;
static std::uint64_t now_ns() {
    timespec value{};
    clock_gettime(CLOCK_MONOTONIC, &value);
    return std::uint64_t(value.tv_sec) * 1000000000ULL + value.tv_nsec;
}

extern "C" __attribute__((noinline, noipa)) void overhead_worker_parent(Workload workload, unsigned index) {
    volatile std::uint64_t frame[2] = {index + 1, index + 2};
    std::uint64_t value = frame[0], completed = 0;
    while (!ready.load(std::memory_order_acquire)) std::this_thread::yield();
    while (running.load(std::memory_order_relaxed)) {
        value = workload(value);
        counters[index].completed.store(++completed, std::memory_order_relaxed);
    }
    std::lock_guard<std::mutex> lock(output);
    std::cout << "COUNT " << syscall(SYS_gettid) << " " << completed << " " << value << std::endl;
}

int main(int argc, char** argv) {
    if (argc != 3) return 2;
    const unsigned count = static_cast<unsigned>(std::strtoul(argv[2], nullptr, 10));
    if (count != 16 && count != 32) return 2;
    void* library = dlopen(argv[1], RTLD_NOW | RTLD_LOCAL);
    if (!library) { std::cerr << dlerror() << std::endl; return 2; }
    auto workload = reinterpret_cast<Workload>(dlsym(library, "generated_workload_entry"));
    if (!workload) { std::cerr << dlerror() << std::endl; return 2; }
    counters = std::make_unique<Counter[]>(count);
    std::cout << "TARGET " << getpid() << " COUNTER_STRIDE " << sizeof(Counter) << std::endl;
    std::vector<std::thread> workers;
    for (unsigned index = 0; index < count; ++index) workers.emplace_back([=] {
        pthread_setname_np(pthread_self(), "busy-worker");
        {
            std::lock_guard<std::mutex> lock(output);
            std::cout << "THREAD busy-worker " << syscall(SYS_gettid) << " " << index << std::endl;
        }
        reported.fetch_add(1, std::memory_order_release);
        overhead_worker_parent(workload, index);
    });
    while (reported.load(std::memory_order_acquire) != count) std::this_thread::yield();
    ready.store(true, std::memory_order_release);
    std::cout << "READY" << std::endl;
    std::string command;
    std::vector<std::uint64_t> values(count);
    while (std::getline(std::cin, command)) {
        if (command == "stop") break;
        if (command.rfind("snapshot ", 0) != 0) continue;
        const auto begin = now_ns();
        for (unsigned index = 0; index < count; ++index)
            values[index] = counters[index].completed.load(std::memory_order_relaxed);
        const auto end = now_ns();
        std::cout << "SNAP " << command.substr(9) << " " << begin << " " << end;
        for (auto value : values) std::cout << " " << value;
        std::cout << std::endl;
    }
    running.store(false);
    for (auto& thread : workers) thread.join();
    dlclose(library);
    std::cout << "STOPPED" << std::endl;
}
