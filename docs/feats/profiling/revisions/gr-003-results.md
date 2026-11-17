# GR-003 symbol locations: implementation and qualification

Implemented per-solution `[profiling].debug_symbol_locations`, exposed as an explicit file/folder list under CPU sampling settings. Saves preserve other TOML/comments, reject stale settings, and replace the file atomically. Relative paths use the solution directory. A new capture freezes its declarations and served-file provenance; settings do not reinterpret existing captures. Legacy manifests retain conventional lookup behavior.

A read-only index includes directory enumeration in its 10,000-entry / 5-second budget, descends at most two directory levels and skips symlinked subdirectories. Exact build-ID matches support renamed files; a relevant named mismatch withholds the module. Explicit withheld-module records enforce that decision independently of the bounded diagnostic examples. A capture-private perf build-ID directory serves verified module/debug links; the user's cache is untouched. Admission is bounded to 512 MiB of module/debug bytes and 15 seconds of discovery plus serving. Per-file fingerprints bind path, canonical path, inode/device, size and hash. Both files and private cache links/bindings are rechecked after decoding and for source navigation/reopen.

Reopen now actually decodes an already-loaded capture instead of returning the cached result. A decode revision refreshes the tree and clears stale frame selection. Missing, moved or changed served files withhold names/source and retain a PARTIAL result. Startup, loss, raw-hash, target-incarnation and source-within-solution restrictions remain separate gates.

| Gate | Result | Evidence / scope |
| --- | --- | --- |
| Automated native regression | PASS | 29 backend tests; settings/comments/staleness, fingerprints, cache-link substitution, index limits, private-cache retention, leaf/loss/raw/source checks |
| Root IPC/native integration | PASS | 28 tests at its build checkpoint; type checking and embedded desktop build passed |
| No declared locations | PASS | Fresh stripped runtime-loaded library; hidden hot name absent |
| Sibling directory | PASS | Matching separate debug file supplies hot name and source-line metadata |
| Renamed file elsewhere | PASS | Build-ID index finds arbitrary filename and perf uses it |
| Same-name decoy | PASS | Different build ID withheld; capture PARTIAL |
| Same-owner reopen | PASS | Decode revision increases; actual raw reparse occurs |
| Moved / missing served file | PASS | Hot names/source withheld; manifest gives reason |
| Changed bytes with same build ID | PASS | Hash/identity refusal despite unchanged build-ID note |
| Capture-private cache / read-only source locations | PASS | Distinct directories, fingerprints and unchanged user `~/.debug` / declared-folder content hashes |
| Cache link substitution | PASS | Unit qualification rejects altered module, debug and build-ID bindings |
| Cache retention | PASS | Unit qualification removes aged capture cache without following its link to the producer file; pinned cache retained |
| Index bound | PASS | 10,001-file fixture cut off visibly at 10,000 entries in 15 ms. Its debug file lay outside the retained enumeration; this is a bound/refusal test, not a 10,000-ELF resolution benchmark |
| Desktop setting and served record | PASS | Xvfb, actual solution save / Profile-only capture / named hidden function / served path, build ID and hash displayed |
| Ordinary-display GR-003 screenshot | NOT TESTED | The separate GR-002 ordinary screenshot timeout remains open; no repeated assumption of full ordinary harness success |
| Target survival / LOST reporting | PASS | Owned fixture remains alive after capture; loss counters recorded per capture |
| Human acceptance / public release | NOT TESTED | Local commits await review |

Machine `sk27`, Linux `7.2.11-arch1-1`, perf `7.2.11-1`. [Backend and desktop evidence](../../../../workspaces/profiling-symbol-locations/evidence-2026-10-24/) contains machine/build hashes, fixture identity, capture manifests, serving identities, parser timings, loss and failure/recovery results. The qualification runner is [qualify_backend.py](../../../../workspaces/profiling-symbol-locations/qualify_backend.py). Raw artifacts remain under `/tmp/craidd-gr003-production-20261024-final`. Desktop executable SHA-256: `0540a63c33715c12c5c3b28da3b0edcf316cc4b2469c3a5f5fff5c88255fbc5d`.

Source-line metadata qualification is distinct from navigation: the existing command still refuses source files outside the solution directory. No engine paths, global defaults, debuginfod or implicit source remapping were added. The 512 MiB and 15-second starting guards are implementation defaults for review, not measured performance promises for arbitrary symbol stores.

Next is the approved GR-004 experimental launch-only helper. No push or merge.

---

*Last updated: 24 October 2026. Author(s): ShinkuKira21.*
*This document is a record.*
