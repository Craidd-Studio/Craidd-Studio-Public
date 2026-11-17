# Experimental embedded Mono map adapter

This is Craidd adapter code, prebuilt for Linux x86_64 GNU (glibc ≥ 2.34), not a bundled Mono runtime or an independent profiler. It observes hosts that dynamically resolve `mono_jit_init_version`; direct linkage, other initialization entry points and other architectures/libcs are unqualified. Startup methods compiled before callback registration remain outside its coverage.

`build.py` is a developer/release-packaging command. It builds `linux-x86_64-gnu/libcraidd_mono_map.so` and records source/artifact hashes, compiler and flags in `manifest.json`. The IDE embeds those bytes, verifies the hash, atomically publishes them into a private cache and uses no runtime compiler. Rebuild with the same toolchain to verify reproducibility; different compiler versions require a new qualification.

The explicit experimental run-configuration opt-in is off by default. Only the launched command receives the preload entry; existing entries are preserved. Attach offers no injection. Captures bind the launch request to PID/start-time ancestry and record helper version/hash, independently of the existing perf-map fingerprint. Helper provenance is a request/coverage record, not proof of activation, source correctness or recovered callers.

Source audit boundaries: only `dlsym` is exported. The helper makes no network calls and changes no runtime options. It creates only `/tmp/perf-<pid>.map` with exclusive/no-follow/append-only flags, current-user ownership and mode 0600. It refuses existing maps. Method names are bounded to 4096 bytes, control characters are normalized to spaces, output is capped at 16 MiB, concurrent callbacks serialize complete records, and inherited callbacks refuse a different PID after fork. Missing exports/output failure produce one diagnostic and leave the host running. Product code does not delete maps.

The native/failure/naming/throughput fixtures are in `workspaces/profiling-embedded-mono/`. Source review and local qualification do not replace human release review. Normal Run Stop and IDE-owned launch teardown keep their existing program-ownership behavior; stopping a perf capture only stops its collector.

---

*Last updated: 24 October 2026. Author(s): ShinkuKira21.*
*This document is a record.*
