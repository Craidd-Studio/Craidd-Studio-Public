# GR-004: embedded Mono launch-helper results

**Status:** Local experimental implementation; human acceptance pending. No push or merge.

The opt-in is saved on a concrete run configuration, off by default. The runner materializes verified prebuilt adapter bytes and adds them only to that target command's `LD_PRELOAD`. Attach offers no helper option. Supported scope is Linux x86_64 GNU, glibc 2.34+, with a host dynamically resolving `mono_jit_init_version`; other initialization paths and ABIs are unavailable or unqualified. Maps are retained, never automatically removed by PID pathname.

## Recorded environment and artifacts

Machine `sk27`, kernel `7.2.11-arch1-1`, perf `7.2.11-1`, installed Mono 6.12. The real fixture embeds Mono without its launcher; fault fixtures exercise export, file, fork and concurrency handling separately. [Evidence and fixtures](../../../../workspaces/profiling-embedded-mono/) include the backend JSON, desktop JSON, screenshots and two matching local rebuilds. Helper 1.0.0 SHA-256: `f358701122fdd6e8fcf2983cb838436da1df63e5b05a45f25067a5e5720423fc`. Compiler and flags are in its bundled manifest.

The Xvfb desktop used embedded build SHA-256 `1a9e4daef467978a8ffdfa2b795189a2a9d4ba3d085eb287ca32c1d590d5eb54`; native qualification used the production manager and the same shipped helper bytes. Debug desktop qualification is separate from the metric editor's release-performance gate.

| Gate | Result | Evidence / boundary |
|---|---|---|
| Known managed leaf naming | PASS | Independent known-method address-range sampled weight: 0% named without helper, 100% with helper; production names retain `perfMap` origin and no verified source. |
| Missing export and host survival | PASS | One diagnostic, no map, host completes. |
| File and lifecycle safety | PASS | Existing stale file and symlink refused; mode 0600; fork cannot append to parent's map; concurrent complete records; 16 MiB cap. |
| Version/hash and startup coverage | PASS | Launch incarnation binding, helper manifest, incomplete startup coverage visible in real capture. Binding records the request, not independent proof of activation. |
| Matched overhead | PASS | Five alternating pairs, 20,000 known-hot calls per case, host steady-clock execution/JIT throughput, no collector. Median slowdown −0.191%; Q1/Q3 −1.324% / +0.042%; min/max −1.862% / +0.806%. Descriptive variation, no speedup or universal zero-overhead claim. |
| Desktop run and attach isolation | PASS | Real configuration save, launch, DWARF 8192/999 Hz capture, named hot leaves, separate self/inclusive shares, helper provenance. External attach environment fingerprint unchanged; target survives capture completion. |
| Automated regression | PASS | Native suite 218 passed, six existing ignored; direct configuration/presentation assertions and TypeScript check pass. Two local rebuilds match the qualified helper hash. |
| Ordinary-display helper workflow | NOT TESTED | The helper workflow was exercised under Xvfb. |
| Human acceptance | NOT TESTED | User review remains required. |

The desktop capture retained 1,987 leaves, including 1,975 empty caller chains, with zero LOST / LOST_SAMPLES records. It is correctly PARTIAL for caller coverage: all leaves contribute self attribution; inclusive attribution uses recovered chains. JIT naming does not repair unwinding.

The general solution writer now preserves the existing `[profiling]` table when saving run configurations, including explicit symbol locations. Unsupported hosts can turn off a previously saved helper option. Runtime compilation, attach injection, automatic runtime detection and map deletion are outside this delivery.

## Integrated release smoke check

The same final release binary as the [metric editor release gates](metric-editor-release-results.md), SHA-256 `a7f1f63f40e79624608214833e4f0e210c48ef9a0d2d9c39ff88d9baf0a24b09`, also passes the real run-configuration launch/capture workflow under Xvfb. Explicit opt-in and persistence, named managed leaves, helper version/hash, incomplete-startup label, absent attach option, unchanged external target environment and capture-target survival all PASS. [Release evidence](../../../../workspaces/profiling-embedded-mono/evidence-2026-10-24/release-mono-launch-results.json) records perf `perf version 7.2.11-1`, DWARF 8192 at 999 Hz for two seconds, 1,992 retained leaves and 1,983 empty chains, with zero LOST / LOST_SAMPLES records. The result remains PARTIAL for caller coverage. This does not repeat the matched-overhead matrix or establish ordinary-display/human acceptance of the helper workflow.

---

*Last updated: 24 October 2026. Author(s): ShinkuKira21.*
*This document is a record.*
