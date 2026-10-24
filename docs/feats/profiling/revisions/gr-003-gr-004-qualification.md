# GR-003 / GR-004 source review and fixture qualification

**Roadmap track:** Phase 3.5 profiling.
**Status:** Historical source review and proposed-delivery evidence at 23 October 2026. Subsequent accepted local implementations are recorded in [GR-002 leaf results](gr-002-leaf-results.md), [GR-003 results](gr-003-results.md) and [GR-004 results](gr-004-results.md). The gates below describe the earlier source, not current delivery.
**Source:** Qualified perf backend `464e407`, integrated with M1 fixes on `codex/profiling-profiler-ui`.
**Machine:** sk27; Linux 7.2.11-arch1-1; perf 7.2.11-1; current user, zero effective capabilities; paranoid 2, kptr_restrict 0, ptrace_scope 1. No policy changes or privileged perf.

## GR-003 (priority 2)

The source review confirms both missing pieces. `debug_identities` verifies conventional candidates; `decode` delegates lookup to perf. No user-declared locations or served-debug-file hashes exist in `Manifest`. `source` rechecks module/candidate build IDs, while `reopen` verifies raw bytes and map provenance. Neither supplies the proposed declared-file identity contract.

[Proposed decisions and delivery](gr-003-symbol-locations.md): per-solution locations first; no user-wide precedence or engine-path heuristics yet. Build one bounded read-only index, verify relevant candidates, stage a private capture cache, fingerprint served bytes, recheck on reopen/source navigation and include cleanup in retention. These choices remain proposed.

[Fixture and evidence](../../../../workspaces/profiling-symbol-locations/README.md) use a stripped runtime-loaded library whose hot function is absent from dynsym, a matching separate debug file in an unrelated sibling folder, a renamed copy elsewhere, and a same-name different-build-ID decoy. Actual perf capture is user-only, per-thread, timestamped DWARF. The successful run explicitly disables debuginfod. Earlier runner attempts omitted user-only callchains, per-thread allocation or timestamps; those runner errors were diagnosed and corrected without changing system policy.

| Gate | Result | Evidence / limit |
| --- | --- | --- |
| No location declared | PASS | Zero hidden-hot-name or source-line records |
| Sibling debug location | PASS | 396 hot-name records; 792 source-line records |
| Renamed debug file via build-ID index | PASS | Same counts; index finds exact build ID |
| Same-name decoy | PASS | Build ID differs; not staged; zero hot-name/source records; this is fixture verification, not a product PARTIAL state |
| Private decoder caches | PASS | Distinct cache directory per case; actual `perf --buildid-dir` + cache entry `debug` link |
| User `~/.debug` unchanged | PASS | Recursive file hashes before/after match |
| Moved served-file mechanism | PASS | A second real decode after moving the served file has zero hot-name records |
| 10,000-entry index | PASS | Exact measured duration in JSON; one debug ELF plus 9,999 short non-ELF files; not 10,000-ELF performance |
| Product manifest / reopen withholding | NOT TESTED | No production served-file contract yet |
| Product retention cleanup | NOT TESTED | No production private cache yet |
| Desktop settings / served-by view | NOT TESTED | Proposed feature |

The raw data, build products and decoder output are in `/tmp/craidd-gr003-qualification-20261023-record`; bounded JSON is committed with the fixture. Private links only work because both module and debug entries are supplied in the installed perf's qualified layout. `perf buildid-cache -a <debug>` alone is not the delivery.

## GR-004 (priority 3)

[Source review and proposed answers](gr-004-embedded-mono-maps.md): reviewed prebuilt helpers per supported architecture/libc are preferable to silently compiling preload code at first use. Put the explicit experimental opt-in on run configurations, with a supported-host description; do not infer Mono from executable names. Attach offers no helper. Both answers remain proposed and release packaging still needs review.

The [owned fixture](../../../../workspaces/profiling-embedded-mono/README.md) embeds installed Mono via dlopen/dlsym and mono_jit_init_version, without the Mono launcher. `MONO_ENV_OPTIONS=--jitmap` is present in both cases. The test-only helper registers after init and records its binary hash. It is not linked into, shipped with, loaded by or configured in Craidd.

| Gate | Result | Evidence / limit |
| --- | --- | --- |
| Embedded host, helper absent | PASS | No map; host exits normally |
| Helper creates known hot-method map entry | PASS | KnownManagedHot recorded; mode 0600; O_EXCL/O_NOFOLLOW |
| Missing required export | PASS | One diagnostic; host continues and exits normally |
| Raw-leaf named known-method sampled weight | PASS | 0% without helper, 100% with helper; actual perf script -G diagnostic while the map exists |
| Existing full-stack decode retains/names known JIT method | FAIL | Zero known-method frame weight in both cases, while raw leaf samples hit its independently recorded JIT address range |
| Matched helper throughput measurement | PASS | Five alternating pairs; median slowdown 0.0759%, range −1.7646% to +2.1930%; no collector, no significance claim |
| Production launch option / helper provenance | NOT TESTED | Not implemented |
| Production attach environment isolation | NOT TESTED | No option or helper was added to any product environment |
| Desktop launch and map-origin inspection | NOT TESTED | Not implemented |

The full-stack gate is not rescued by the raw-leaf pass. On this fixture perf's DWARF callchain output omits the known JIT leaf when unwind context is absent; its separate raw-leaf output names the same address using the helper map. The current parser correctly cannot invent a missing frame. This is an additional delivery prerequisite: qualify retaining the sampled leaf from perf even when no callers unwind, preserve empty/truncated-stack coverage and avoid claiming inclusive time. No fallback, separate decoder, runtime option workaround or product change was built. This proposed prerequisite needs review before GR-004 implementation.

Matched timing includes execution/JIT within mono_jit_exec and excludes initial host setup. It is a reproducible fixture result, not proof of no overhead in an engine. Startup methods compiled before callback registration remain outside the helper's coverage. Direct-linked Mono, other initialization functions and architectures are unqualified.

Results and raw samples remain in `/tmp/craidd-gr004-matched-20261023-v2` and `/tmp/craidd-gr004-samples-20261023-verified`; hashes, observations and gate JSON are committed with the fixture. Product .NET limitations are unchanged.

---

*Last updated: 24 October 2026. Author(s): ShinkuKira21.*
*This document is a record.*
