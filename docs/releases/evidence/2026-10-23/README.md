# Release-audit evidence, 23 October 2026

**Roadmap track:** Wider Linux IDE gate.
**Status:** Mixed results; see the [assessment](../../public-release-readiness-2026-10-23.md). No release or human sign-off.

[Portable results](results.json) retain source identities, machine/tool versions,
binary hashes, commands, per-file test counts, initial failed attempts, scoped
repeats, metrics observations and preservation checks. Counts from different
revisions overlap and must not be added as one product result. Ignored raw
logs/screenshots remain at the paths named in the assessment.

## Selected images

| Image | Interpretation |
| --- | --- |
| [Debugger hover](debugger-hover.png) | C# is paused and Watch has a value, while the requested hover remains absent. |
| [Explorer edge](explorer-edge.png) | The menu is outside the screenshot's visible content; its measured rectangle is retained in the report. Do not interpret its absence as proof that no menu was created. |
| [Wizard at 900 px](wizard-template-900.png) | Copied working-file wizard; primary action stays reachable and Planned items remain labelled. This is automated layout evidence, not human acceptance. |
| [Generated Rust debug](wizard-rust-debug.png) | The disposable wizard-created project pauses on its generated source under the installed debugger. |
| [Unity rollover](unity-long-rollover.png) | Retention reaches 2,400 samples and starts aging, while Coverage interrupted and 155 source gaps fail the collection gate. |
| [Existing metric editor](metric-current-editor.png) | Actual M1 UI after the scoped automated checks. Passing data/navigation/latency assertions does not approve this visual design. |

The supplied [concept image](../../../feats/profiling/assets/metric-inspection-candidate-2026-10-22.png)
is kept separately from these actual desktop captures.

## Reproduction boundaries

Read `AGENT.md` and the [harness README](../../../../tests/ui/README.md).
Build/test the exact source being claimed. The wizard is a working-file
snapshot; its file hashes are in the JSON. CSV and perf results use separate
feature refs. Preserve dirty work and do not replace the currently running
user's binary or select an existing Editor to reproduce these tests.

Normal checks used the installed, recorded dependencies and offline Cargo:

```sh
node --test tests/*.test.mjs
# The audit additionally invoked each file directly to retain individual totals.
node tests/profiling.test.mjs
npm run build
CARGO_TARGET_DIR=/tmp/craidd-release-build CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0 CARGO_INCREMENTAL=0 cargo test --locked --offline --manifest-path src-tauri/Cargo.toml -j 4
# Run after cargo test so the embedded frontend, rather than a dev URL, is built:
CARGO_TARGET_DIR=/tmp/craidd-release-build CARGO_PROFILE_DEV_DEBUG=0 CARGO_INCREMENTAL=0 npm run test:ui:build
```

The complete baseline desktop run invoked every `tests/ui/*.test.mjs` directly
and serially with `CRAIDD_TEST_UNITY=1`, private Xvfb and the frozen audit binary.
An equivalent ordinary package entry point is `npm run test:ui` with that opt-in.
The sustained gate was explicitly selected without test-process isolation so
the actual named test ran on the installed Node runtime:

```sh
env -u WAYLAND_DISPLAY GDK_BACKEND=x11 CRAIDD_UI_APP=/tmp/craidd-release-build/debug/craidd-studio CRAIDD_TEST_UNITY=1 CRAIDD_TEST_LONG=1 xvfb-run -a -s '-screen 0 1920x1080x24' node --test --test-isolation=none --test-name-pattern='uncapped fps' tests/ui/unity-profiling.test.mjs
```

CSV checks additionally require its feature source, generated million-row file,
optimized embedded release build and existing opt-ins. Its own fixture README
defines the workload and display-serial performance protocol. This audit ran
Xvfb only; ordinary-display timing, native picker and human review remain open.

The Markdown browser scripts used a temporary local Vite fixture server,
installed Chrome and a disposable Playwright install. The audit copies changed
only their hardcoded screenshot destinations. IPC is mocked in that fixture.
The tracked fixture repair adds the current file-tab identity/kind and active
tab ID. Browser functional success is separate from native desktop acceptance.

## Event-loss investigation

The uncapped gate records sequence gaps independently from rolling retention.
The initial short run had 1,251 missing source events at its failing assertion;
the post-build short repeat passed. The later standalone sustained run reported
155 missing events at the final rollover observation; the 633.267-second run
fails its zero-loss assertion. The post-rollover inspection tail is not reached.
Preserve its final result and checkpoints
alongside the initial failure; zero rejected events or bounded history does
not erase sequence loss.

The native SDK increments its event sequence before a nonblocking `send` and
deliberately leaves an unsent EAGAIN/EWOULDBLOCK/EINTR event detectable as a gap
(`support/profiling/craidd_gold.hpp:101–123`). The collector detects sequence
discontinuity (`src-tauri/src/commands/profiling.rs:420–440`). This supplies a
possible mechanism, not proof of the exact error responsible for this run.
The current evidence lacks per-send return/errno and drain-latency counters.
Correlate those with sequence/time/rate before choosing a bounded transport or
collection repair; do not hide loss, make retention unlimited or block a
producer merely to turn the test green.

---

*Last updated: 23 October 2026. Author(s): ShinkuKira21.*
*This document is a record.*
