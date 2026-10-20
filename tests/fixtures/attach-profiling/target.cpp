#include <cstdio>
#include <cstdlib>
#include <sys/prctl.h>
#include <unistd.h>
// Only this disposable fixture opts into sibling debugger attach. Never change host policy.
__attribute__((noinline)) int work(int value) {
    volatile int result = value * 2; // BREAK_HERE
    return result;
}
int main() {
    prctl(PR_SET_PTRACER, PR_SET_PTRACER_ANY, 0, 0, 0);
    for (int counter = 0; ; ++counter) {
        std::printf("%d\n", work(counter)); std::fflush(stdout);
        usleep(100000);
    }
}
