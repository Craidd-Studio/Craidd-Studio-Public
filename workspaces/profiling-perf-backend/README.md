# Timed perf backend fixture

This no-UI harness imports the production Rust capture manager and parser.
It qualifies the backend separately from Tauri IPC and desktop behaviour.
Use the installed perf version as the normal user; no policy changes or
privileged execution are part of these commands.

From the repository root:

```sh
cargo test --offline --manifest-path workspaces/profiling-perf-backend/Cargo.toml
cargo build --offline --release --manifest-path workspaces/profiling-perf-backend/Cargo.toml
python3 workspaces/profiling-perf-qualification/many_thread_qualification.py build --output /tmp/new-perf-build
python3 workspaces/profiling-perf-backend/qualify_backend.py --harness workspaces/profiling-perf-backend/target/release/craidd-perf-backend-fixture --build /tmp/new-perf-build --output /tmp/new-perf-backend
```

The output directory must not exist. The runner exercises FP and both DWARF
stack sizes, source locations, foreign-owner refusal, pinning, Stop, owner close
and replacement-owner reopening, collector failure, manager shutdown, positive
loss, target exit, stale identities, newly observed threads and an independent
manager's reopen. The final 32-worker/999-Hz/16-KiB capture tests the proposed
512 MiB raw cap. Fixtures exit through stdin. Fault injection addresses only
the collector through a verified pidfd. The capture/cache artifacts and full
manifests remain under the fresh output directory.

Do not run competing benchmark/qualification workloads in parallel. Ordinary
desktop timing is not a controlled slowdown benchmark. The core harness uses
an unsupervised child spawner; the actual IDE integration uses Craidd's existing
process supervisor. Tests of real window and IDE shutdown remain separate.

`evidence-2026-10-22.json` records the optimized run and every gate. The binary
positive-loss fixture contains exact extracted LOST/LOST_SAMPLES records under
a rebuilt minimal regular-file header; `fixtures/provenance.json` records the
parent capture hash, extraction basis and perf dump parity. The smaller text
fixture is three explicit-field blocks from perf 7.2.11-1, with only trailing whitespace
and extra EOF blank lines normalized; the older
text loss records come from the preserved 20 October installed evidence.
No fixture claims compatibility with a second perf version.

See the [backend results](../../docs/feats/profiling/revisions/perf-timed-backend-results.md)
and [accepted decisions](../../docs/feats/profiling/revisions/perf-timed-implementation-decisions.md).

---

*Last updated: 22 October 2026. Author(s): ShinkuKira21.*
*This document is a record.*
