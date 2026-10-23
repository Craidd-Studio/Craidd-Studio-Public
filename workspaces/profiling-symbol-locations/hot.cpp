#include <cstdint>
#ifndef DECOY
#define DECOY 0
#endif
static __attribute__((noinline,noipa)) std::uint64_t hidden_symbol_location_hot(std::uint64_t value) {
    for(unsigned i=0;i<160000;++i) value=(value*6364136223846793005ULL+(i+1+DECOY))^(value>>13);
    return value;
}
extern "C" __attribute__((noinline,noipa)) std::uint64_t generated_workload_entry(std::uint64_t value) { return hidden_symbol_location_hot(value); }
