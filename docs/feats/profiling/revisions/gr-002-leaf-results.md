# GR-002 sampled-leaf correctness checkpoint

Self attribution now uses an authoritative leaf-only decode of the same raw capture. It preserves the sampled IP separately from symbol interning. Exact sample identities reconcile recovered caller chains; empty/mismatched chains keep their leaf and contribute zero inclusive weight. Explicit depth/retention truncation preserves the recovered portion, labelled partial. Caller availability does not assert complete unwinding. Both decode passes retain existing scope, symbol/map provenance, loss and retention checks, and the raw hash is rechecked after both passes.

The result records counts and event weight by thread and leaf module. Bottom-up and top-down trees retain leaf-only self entries, with separate self/inclusive populations and a shared all-selected-event denominator. Coverage details expose the missing/truncated/mismatched chain counts. Reopening redoes both decodes and their integrity checks; no reconstruction of missing callers occurs.

Fresh fixture captures on `sk27`, Linux `7.2.11-arch1-1`, perf `7.2.11-1`, optimized no-UI production-manager harness:

| Fixture / mode | Authoritative leaves | Self event weight (ns) | Empty chains | Decode / parser CPU |
| --- | ---: | ---: | ---: | --- |
| Normal native, FP 99 Hz | 197 | 1,989,898,970 | 0 | 50 / 0 ms |
| Normal native, DWARF 8192, 99 Hz | 198 | 1,999,999,980 | 0 | 51 / 1 ms |
| Embedded Mono, DWARF 8192, 999 Hz | 1,994 | 1,995,995,994 | 1,981 | 58 / 4 ms |

Every row matches an independent `perf script -G` sample count and sum of event periods, the reconciled self population, and the sum of bottom-up root self weights. The normal known hot function remains the top self entry. The Mono fixture uses the existing test-only map helper to qualify the unwinding defect; this does not deliver the GR-004 product helper.

| Gate | Result | Scope |
| --- | --- | --- |
| Automated parser / capture regressions | PASS | 24 tests; duplicate timestamps, distinct literal IPs sharing one symbol, empty chains, mismatch refusal, truncation, recorded installed-perf Mono output, loss/raw/source/retention tests |
| Native FP and DWARF totals | PASS | Fresh captures, independent counts and weights |
| Unwind-defeating leaf module | PASS | 1,981/1,994 empty chains, all sampled self retained |
| Per-thread / leaf-module coverage | PASS | Recorded populations sum to retained totals |
| LOST accounting | PASS | Zero LOST / LOST_SAMPLES records in all three; independent complete loss scan |
| Reopen and target survival | PASS | Both raw passes reproduced totals while the original target/map incarnation remained alive; targets ended through fixture stdin only |
| Desktop leaf names / self / coverage | PASS | Real Profile-only target and DWARF capture through IDE controls; managed map origin, root self totals and coverage table verified on ordinary display and Xvfb |
| Desktop screenshot evidence | PARTIAL | Xvfb succeeds; ordinary-display WebDriver screenshot times out after assertions completed. No product correctness or performance claim inferred from that timeout |
| UI thread independence | PASS within scope | Native decoding remains on owned worker/parser threads; desktop controls/coverage completed. No large-load latency claim |
| Updated large-symbol / overhead / release metrics | NOT TESTED | Separate existing evidence; dual-decode costs above only qualify these fixtures |
| Human acceptance | NOT TESTED | Local changes await user review |

[Machine-readable evidence and screenshot](../../../../workspaces/profiling-perf-backend/leaf-evidence-2026-10-24/), [qualification runner](../../../../workspaces/profiling-perf-backend/qualify_leaves.py), [decision](gr-002-leaf-preservation.md). Each evidence record includes executable hash, machine, raw path, fixture identity, result, loss counts and coverage. The committed 20-record parser excerpt removes trailing header spaces only; the original perf output is retained with the qualification artifacts. Raw captures remain under `/tmp/craidd-perf-leaf-20261024-first`; they are not committed. The ordinary-display screenshot timeout remains open; do not call its whole harness run PASS.

Next: approved GR-003 backend settings and symbol serving, then GR-004 experimental launch-only helper. Local commits only; no push or merge.

---

*Last updated: 24 October 2026. Author(s): ShinkuKira21.*
*This document is a record.*
