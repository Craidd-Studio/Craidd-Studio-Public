# GR-003: User-declared debug-symbol locations for perf captures
Status: proposed revision. Not implemented. Craidd baseline reviewed: codex/profiling-perf-timed at 464e407. Area: Profiler, GR-002 timed capture (symbol resolution).

Summary
Let a user name folders or files where debug symbols live, and make perf actually use the matching ones (verified by build ID). Programs built with common engines and toolchains ship stripped binaries whose debug files are kept somewhere else, and today those frames show unnamed.

Problem
debug_identities (src-tauri/src/perf_capture.rs) checks a bounded set of conventional candidates for a module:

the .gnu_debuglink name beside the module, and in .debug/ beside it;
/usr/lib/debug/<module dir>/;
/usr/lib/debug/.build-id/xx/yyyy.debug.
That is right for distribution packages, but real program builds commonly keep debug files elsewhere:

An engine's player runtime is shipped stripped (only .dynsym and .gnu_debuglink). Its matching <name>_s.debug sits in the engine's editor installation, under a per-variant playback-engine folder, not beside the binary.
Ahead-of-time compiled application code (the engine's C#-to-native backend, for example) is stripped in the build output. Its <name>.debug is written to a sibling folder named "back up this folder, but don't ship it".
Build systems that emit symbols into a separate symbol or artifact directory.
Two separate parts are missing:

Verification: Craidd doesn't know these folders, so it can't verify them.
Resolution: even after Craidd verifies a match, perf does its own lookup. perf won't find a debug file that isn't in one of its search places, so the frames stay unnamed whatever Craidd verified.
Observed outside Craidd, with perf 7.2.11 on a stripped 42 MB engine runtime whose debug file has the same build ID:

perf buildid-cache -a <debug file> did not make perf use it;
a debug link inside perf's cache entry for that build ID did: <buildid dir>/<module path>/<build-id>/debug;
engine frames went from 7% to 100% named, with no change to the capture.
Proposal
Declaring locations
Per solution, a list of debug-symbol locations (folders, searched non-recursively or to a small fixed depth, or single files), stored with the solution's profiling settings.
Per capture, show which locations were searched and which candidates matched.
No network lookup (debuginfod stays disabled, as decided). No writes into the declared folders.
Verification
For each sampled module with a build ID, look for candidates in the declared locations:
by .gnu_debuglink name;
by <build-id>.debug and .build-id/xx/yyyy.debug layouts;
by a bounded index of the ELF build IDs of files in those locations (built once per capture, with a file-count and time limit that is reported).
Keep today's guard: only a matching build ID is used. A mismatch or an unverifiable candidate withholds that module's names and source mappings, and marks the capture PARTIAL, as now.
Making perf use verified files
For decoding, give perf a private build-ID directory per capture (perf's --buildid-dir, or the equivalent for the qualified perf version) containing links to the module and its verified debug file. That is the layout that worked above.
Never modify the user's own ~/.debug.
Record in the capture manifest which debug file served each module, with its hash, so a reopened capture can recheck it, exactly as the perf-map fingerprint is rechecked today.
If a declared file changes or disappears before a reopen, withhold its names and say why.
Out of scope
Windows PDB files and any symbol server.
Recursive scans of large trees without a declared limit.
Path remapping for source navigation beyond what already exists.
Existing foundation
src-tauri/src/perf_capture.rs: debug_identities, elf_build_id, the module-identity checks and the conservative withholding policy.
docs/feats/profiling/revisions/perf-timed-implementation-decisions.md: no implicit debuginfod; separate gates.
docs/feats/profiling/revisions/perf-scale-and-dotnet-diagnostic-results.md: separate debug-file scale evidence.
Acceptance
Fixtures in workspaces/: a runtime-loaded library stripped to .gnu_debuglink only, with its debug file placed in (a) an unrelated sibling folder and (b) a folder elsewhere on disk under a different file name. Plus a decoy debug file with the same name and a different build ID.

Automated:

No locations declared: the module is unresolved, as today.
Declared: names and source lines resolve for (a) and (b).
The decoy is rejected, and the module is withheld and marked PARTIAL.
The private build-ID directory is per capture and is cleaned up with the capture's retention.
~/.debug is unchanged, by hash.
A reopen with the debug file moved withholds names and gives the reason.
Desktop: declare a location, capture, see named frames, and see the per-module "served by" record.

Limits: an index over a folder of 10,000 files stays within its stated time budget, or reports that it was cut short.

Open questions
Settings only per solution, or also a user-wide list (for example one engine installation shared by many solutions)?
Should Craidd suggest locations it can recognise (an engine installation's playback-engine folders, a build's "don't ship" symbol folder), always as an opt-in suggestion?

## Source review and proposed delivery (23 October 2026)

Reviewed `debug_identities`, `elf_build_id`, `decode`, `source`, `Manifest` and `reopen` against the qualified backend at `464e407` and the UI integration branch. Current conventional candidates are checked by build ID; a bad candidate withholds the whole module. No user location settings, private decoder build-ID cache or served-file hash currently exist. Module and map provenance are distinct; map names never establish source provenance. Reopen verifies raw data and current identities, but cannot revalidate an undeclared served debug file.

Proposed answers: start with per-solution settings only. A user-wide list is a follow-up with explicit precedence and disclosure. Do not add engine-specific path heuristics in this delivery. The user selects directories/files; recognized-folder suggestions remain proposed, opt-in, and require a separate source of declarations.

Proposed backend delivery: canonicalize read-only declared locations, cap 16 locations / depth 2 / 10,000 entries / 5 seconds per capture index, report incomplete search, and bound file inspection and subprocess time. Do not scan symlinked directories or follow cycles. Treat only relevant named candidates or exact build-ID matches as candidates for a module; unrelated ELF files must not poison every module. A conflicting named candidate stays a visible conservative refusal.

Populate a capture-owned cache only from verified module/debug pairs. Qualify the installed perf global `--buildid-dir` option and its exact debug-link layout before implementing. Never touch the user's cache or declared folders. Record served path, canonical identity, size and SHA-256 before and after decode; bind it to the captured module build ID. On reopen and source navigation recheck the served bytes, not only the build ID. A moved/missing/changed file withholds module names and source and marks PARTIAL. Cache links are untrusted input after creation; recreate or verify them from recorded paths. Retention owns their cleanup. Old manifests keep their original conventional lookup behavior.

The native fixture qualification is a mechanism checkpoint. It does not by itself deliver settings persistence, production manifest migration, desktop settings or revalidation gates.

---

*Last updated: 24 October 2026. Author(s): ShinkuKira21.*
*This document is a design.*
