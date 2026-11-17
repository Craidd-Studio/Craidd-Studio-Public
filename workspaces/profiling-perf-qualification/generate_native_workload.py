#!/usr/bin/env python3
"""Generate64 four-function native chains (256 functions plus one entry).

This is an illustrative native workload, not Unity/IL2CPP acceptance. Build with
debug info, omitted frame pointers and sibling-call optimisation disabled.
"""
import argparse
from pathlib import Path


def generate():
    lines = ["#include <cstdint>", '#define NODE extern "C" __attribute__((noinline,noipa)) std::uint64_t']
    for chain in range(64):
        suffix = f"{chain:03}"
        lines.append(f"NODE generated_leaf_{suffix}(std::uint64_t n) {{")
        lines.append("  volatile std::uint64_t frame[2] = {n, n + 1}; n = frame[0];")
        lines.append(f"  for (unsigned i=0; i<100000; ++i) {{ n ^= n << 13; n ^= n >> 7; n ^= n << 17; n += {chain + 1}; }}")
        lines.append("  frame[1] = n; return frame[1]; }")
        for layer, callee in [("inner", "leaf"), ("middle", "inner"), ("outer", "middle")]:
            lines.append(f"NODE generated_{layer}_{suffix}(std::uint64_t n) {{")
            lines.append(f"  volatile std::uint64_t result = generated_{callee}_{suffix}(n); return result + {chain + 1}; }}")
    lines.append("NODE generated_workload_entry(std::uint64_t n) { std::uint64_t result; switch (n & 63) {")
    for chain in range(64):
        lines.append(f"  case {chain}: result = generated_outer_{chain:03}(n); break;")
    lines.append("  default: result = n; break; } volatile std::uint64_t keep = result; return keep; }")
    return "\n".join(lines) + "\n"


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    if args.output.exists():
        parser.error("refusing to overwrite an existing generated source")
    args.output.write_text(generate())
