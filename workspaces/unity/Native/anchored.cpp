#include "craidd_gold.hpp"
// Place a paired Gold Start/End on these explicit source anchors, prepare the
// copy in Craidd, then configure CMake with -DCRAIDD_GOLD_SOURCE=<copy>/anchored.cpp.
extern "C" __attribute__((visibility("default"),noinline)) int craidd_probe_anchored(int count) {
    CRAIDD_GOLD_START();
    unsigned result=1;
    for(int i=0;i<count;++i) result=result*31u+static_cast<unsigned>(i);
    CRAIDD_GOLD_END();
    return static_cast<int>(result&0x7fffffff);
}
