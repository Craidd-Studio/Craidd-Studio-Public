# Managed perf-map qualification fixture

This small shared .NET/Mono program runs two named busy workers in no-inline
`KnownJitHot`/`KnownJitParent` methods. Stdin `stop` or EOF ends it normally. It
is a bounded naming probe, not a JIT profiler or stack-coverage benchmark.

Use installed .NET 10 SDK/runtime and, optionally, Mono/mcs. The build uses an
empty local feed and disables targeting-pack downloads and auditing; missing
installed requirements fail rather than downloading them. From the repository
root, with fresh absolute output directories:

```sh
sh workspaces/profiling-perf-managed/build.sh /tmp/new-managed-build
cargo build --offline --release --manifest-path workspaces/profiling-perf-backend/Cargo.toml
PYTHONDONTWRITEBYTECODE=1 python3 workspaces/profiling-perf-managed/qualify_maps.py --build /tmp/new-managed-build --harness workspaces/profiling-perf-backend/target/release/craidd-perf-backend-fixture --output /tmp/new-managed-results
```

The runner enables `DOTNET_PerfMapEnabled=1` only for its own .NET fixture,
`--jitmap` only for its own Mono fixture, and tests each against a map-disabled
run. It takes two-second FP captures at 99 Hz after a two-second warm-up. The
production manager owns perf; the runner stops fixtures only through stdin.
It reads maps without changing/deleting them, copies them as evidence, and uses
perf's existing script path. No `perf inject`, runtime security changes, custom
map resolver, policy change or privileged collection is part of the standard
probe. The separately authorized diagnostic below changes only one fixture
process environment.

Method-named shares use **leaf period weight** of fixture managed methods over
all decoded leaf period weight, with exact numerators/denominators. They are
not a share of resolved stack frames or proof of caller coverage. Map origin
and module/build-ID origin are distinct. A successful decode does not imply
that the runtime's naming gate passed. Check `captureDecodeGate` and
`methodNamesGate` separately. Without-map cases are observations/controls.

The [recorded results](../../docs/feats/profiling/revisions/perf-backend-follow-up-results.md)
report Mono success and .NET failure on this installed configuration. The
[evidence JSON](evidence-2026-10-22.json) includes source/binary/map/raw hashes,
actual perf/product trees, runtime versions, sampled weight and survival.
Temporary raw files and runtime-map copies remain under the output paths in
that JSON; they are not bundled into the repository.

## 23 October: one explicitly authorized W^X diagnostic

Exactly one extra .NET enabled-map capture ran with W^X disabled. Selectors
avoid rerunning the four-case matrix. This is qualification tooling only: no
product setting, retry or workaround is added. To reproduce that diagnostic
only when explicitly authorized, with a fresh output directory:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 workspaces/profiling-perf-managed/qualify_maps.py --build /tmp/new-managed-build --harness workspaces/profiling-perf-backend/target/release/craidd-perf-backend-fixture --output /tmp/new-wx-diagnostic --runtime dotnet --map enabled --diagnostic-disable-wx
```

`DOTNET_EnableWriteXorExecute=0` is applied only to the owned fixture. The
[diagnostic JSON](evidence-2026-10-23-wx-diagnostic.json) records the resulting
100% named method leaf weight and absence of doublemapper mappings. **Normal
.NET map naming remains FAIL**. See the [scope and known limitation](../../docs/feats/profiling/revisions/perf-scale-and-dotnet-diagnostic-results.md).
No automatic environment override is introduced for normal captures.

---

*Last updated: 23 October 2026. Author(s): ShinkuKira21.*
*This document is a record.*
