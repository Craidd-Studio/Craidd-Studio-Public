# GR-004: JIT maps for embedded runtimes that ignore environment options

**Status:** Proposed revision, not implemented in Craidd. Priority 3, after GR-003 and the timed perf interface.
**Baseline reviewed:** `codex/profiling-perf-timed` at `464e407`, with the current UI integration branch.
**Area:** GR-002 timed capture; launch-only managed frame naming.

## Problem and scope

A host embedding Mono owns runtime initialization. It can ignore `MONO_ENV_OPTIONS`; `--jitmap` belongs to Mono's launcher and must not be passed to `mono_jit_parse_options`. The proposal is an explicit experimental run-configuration option, off by default: **Write a JIT map for an embedded Mono runtime**. Attach offers no injection or retroactive helper. CoreCLR, AOT symbols, unwind tables and inclusive attribution through JIT frames remain separate concerns.

A small versioned helper, present before the runtime initializes, observes a supported initialization path, registers `mono_profiler_create` / `mono_profiler_set_jit_done_callback`, and appends code start, size and method name to `/tmp/perf-<pid>.map`. It uses exported code-info/name/free functions. Missing functions produce one diagnostic and leave the host running. The helper writes no other files, opens no network connection and changes no runtime options. Mode 0600, current-user ownership, no symlink following, bounded names and serialized callbacks are required. Refuse an existing stale map rather than appending a different process incarnation's entries.

## Source review

`inspect_perf_map` fingerprints a bounded, read-only map and distinguishes its names from ELF/build-ID names. Decode checks the target incarnation and the map before/after parsing. Reopen checks the stored fingerprint against the current map; changed/missing map names are withheld. Map-resolved frames have `symbolOrigin: perfMap` and no source location. That mechanism can consume helper output without a second decoder.

The current `Manifest` records map provenance, not a launch helper's version/hash, launch coverage or ownership. Those fields and a trusted launch-to-capture binding are required. The process supervisor already owns launched child identities and cleanup; adding preload globally there would contaminate unrelated collectors/adapters. Apply the option only to the particular target command built from its run configuration, before supervisor spawn. Preserve any existing preload entries explicitly, without shell string interpolation. Do not mutate Craidd's environment or any attach command.

The proposed `dlsym` interception covers hosts which dynamically resolve `mono_jit_init_version`. It does not cover every embedding strategy, direct linkage, alternative initialization entry point, static Mono or every architecture/libc. Those are capability boundaries to qualify, not automatic runtime detection. Methods compiled before callback registration remain unnamed; every helper-enabled capture must say startup coverage is incomplete.

## Proposed answers and delivery

Prefer a reviewed, prebuilt helper per supported architecture/libc, with reproducible source, version and hash in the release artifact. Building native preload code silently at first use adds compiler availability, provenance and failure paths to a capture feature. A developer-only build-from-source path may be a follow-up; unsupported architectures show unavailable. This is a proposal requiring release-policy review, including the repository's tool-bundling boundary: the helper is Craidd adapter code, not a bundled runtime or external profiler.

Expose the opt-in on run configurations generally under experimental profiling settings, with a clear supported-host description. Do not infer that an executable embeds Mono from a filename. A future declared capability may narrow availability; attach remains unavailable in all cases. Retain the user's explicit choice per configuration and show the effective launch setting before execution.

Deliver after the fixture's naming/overhead gates: hardened helper and export/host qualification; typed configuration and launch-only environment assembly; helper provenance in captures and incomplete-startup label; owner/incarnation-aware map lifecycle; then desktop launch/capture acceptance. Cleanup is permitted only for a map whose creation, inode, owner and fingerprint are recorded for a Craidd-launched process that has ended. A matching pathname or reused PID alone never authorizes deletion. Reopen may withhold names after permitted cleanup, and says so; maps are not silently recreated or substituted.

## Acceptance

The owned fixture embeds installed Mono through `dlopen`/`dlsym` and `mono_jit_init_version`, without the Mono launcher or `--jitmap`. Qualify map absent/present, known hot names, one missing-export diagnostic and host survival; actual sampled managed-weight naming with and without the helper; matched alternating host-throughput repetitions; and unchanged attach environments. Desktop must enable the run option, launch, capture and inspect the map-origin label, while attach exposes no helper option. Gates remain independent. A fixture-only preload library is not a shipped feature.

---

*Last updated: 24 October 2026. Author(s): ShinkuKira21.*
*This document is a design.*
