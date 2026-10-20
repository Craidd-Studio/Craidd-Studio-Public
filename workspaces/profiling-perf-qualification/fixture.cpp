// GR-002 native-only qualification target. stdin "stop" is normal shutdown.
#include <atomic>
#include <chrono>
#include <cstdint>
#include <iostream>
#include <mutex>
#include <pthread.h>
#include <string>
#include <sys/syscall.h>
#include <thread>
#include <unistd.h>
#include <vector>

static std::atomic<bool> running{true};
static std::mutex output;
static thread_local volatile std::uint64_t sink;

extern "C" __attribute__((noinline, noipa)) std::uint64_t known_hot(std::uint64_t n) {
    // Force a real stack frame: GCC may omit a frame in a stackless leaf even
    // with frame-pointer flags. The two builds must actually differ here.
    volatile std::uint64_t frame[2] = {n, n + 1};
    n = frame[0];
    for (unsigned i = 0; i < 1000000; ++i) {
        n ^= n << 13;
        n ^= n >> 7;
        n ^= n << 17;
    }
    sink = n;
    return n;
}

extern "C" __attribute__((noinline, noipa)) std::uint64_t known_pool(std::uint64_t n) {
    volatile std::uint64_t frame[2] = {n, n + 1};
    n = frame[0];
    for (unsigned i = 0; i < 100000; ++i) n = n * 6364136223846793005ULL + 1;
    sink = n;
    return n;
}

extern "C" __attribute__((noinline, noipa)) void hot_parent() {
    std::uint64_t n = 1;
    while (running.load(std::memory_order_relaxed)) n = known_hot(n);
}

static void worker(const char* name, unsigned index, bool hot) {
    pthread_setname_np(pthread_self(), name);
    {
        std::lock_guard<std::mutex> lock(output);
        std::cout << "THREAD " << name << " " << syscall(SYS_gettid) << " " << index << std::endl;
    }
    if (hot) hot_parent();
    else {
        std::uint64_t n = index + 1;
        while (running.load(std::memory_order_relaxed)) {
            n = known_pool(n);
            std::this_thread::sleep_for(std::chrono::milliseconds(2));
        }
    }
}

int main() {
    std::cout << "TARGET " << getpid() << std::endl;
    std::vector<std::thread> workers;
    workers.emplace_back(worker, "hot-worker", 0, true);
    workers.emplace_back(worker, "pool-worker", 1, false);
    workers.emplace_back(worker, "pool-worker", 2, false);
    std::string command;
    while (std::getline(std::cin, command) && command != "stop") {}
    running.store(false);
    for (auto& thread : workers) thread.join();
    std::cout << "STOPPED" << std::endl;
}
