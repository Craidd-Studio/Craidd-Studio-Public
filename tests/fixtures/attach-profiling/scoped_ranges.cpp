// Harness-only controlled intervals, compiled only in a disposable plugin copy.
#include "../../../support/profiling/craidd_gold.hpp"
#include <memory>
namespace { std::unique_ptr<craidd_gold::Range> outer, inner; }
extern "C" {
__attribute__((visibility("default"))) void craidd_harness_begin(int nested) {
    auto& range=nested?inner:outer;
    if(!range)range=std::make_unique<craidd_gold::Range>(nested?"harness.inner":"harness.outer",nested?"Harness inner window":"Harness outer window");
}
__attribute__((visibility("default"))) void craidd_harness_end(int nested) {
    auto& range=nested?inner:outer;
    if(range){range->finish();range.reset();}
}
}
