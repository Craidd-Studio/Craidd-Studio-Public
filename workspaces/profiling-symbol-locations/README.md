# Debug-symbol location qualification

Fixture-only GR-003 mechanism; production location settings, served-file provenance and retention/reopen integration remain proposed.

Run in a fresh output directory as an ordinary user:

```sh
python3 workspaces/profiling-symbol-locations/qualify.py --output /tmp/new-gr003-qualification
```

Requires installed g++, binutils and perf. Builds a runtime-loaded stripped library and matching separate debug information in an unrelated sibling directory, an identical debug file under a different name, and a same-name build-ID decoy. A capture-owned `--buildid-dir` gets an `elf` entry through perf's own cache command and a verified `debug` link. The producer/module/debug directories are never modified during decode. `--no-buildid-cache` prevents recording into the user's cache, whose contents are hashed before and after.

The renamed file is found by a bounded ELF build-ID index. The 10,000-entry fixture contains one real debug ELF and 9,999 short non-ELF files; it does not establish 10,000-ELF inspection performance. The prototype budget is 5 seconds / 10,000 entries, with a 3-second maximum readelf operation; a production global deadline must include per-file work and directory enumeration. Missing served-file decode and raw results are recorded separately from the unimplemented production reopen guard. Never report the prototype's decision as a product PARTIAL state.

`evidence-2026-10-23.json` records the machine, perf version, hashes, real decode counts, private caches, moved-file probe and index. The capture target shuts down normally through stdin. No sysctl, capability, elevation or network lookup is used.
