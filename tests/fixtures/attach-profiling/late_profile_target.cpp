#include "craidd_gold.hpp"
#include <atomic>
#include <chrono>
#include <iostream>
#include <thread>
int main() {
    std::atomic<bool> running{true};
    std::thread worker([&] {
        while (running) {
            craidd_gold::solo("late.solo", "Late recording");
            craidd_gold::Range range("late.work", "Late work");
            range.finish();
            std::this_thread::sleep_for(std::chrono::milliseconds(10));
        }
    });
    std::cout << "READY" << std::endl;
    std::string stop; std::getline(std::cin, stop);
    running = false; worker.join();
}
