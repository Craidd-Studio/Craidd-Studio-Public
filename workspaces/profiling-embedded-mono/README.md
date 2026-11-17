# Embedded Mono map qualification

This is a test-only preload library. Craidd does not ship, load or activate it. It supports only the fixture's dynamic `dlsym(mono_jit_init_version)` path; it is not a general embedding adapter.

```sh
python3 workspaces/profiling-embedded-mono/qualify.py --output /tmp/new-embedded-mono
python3 workspaces/profiling-embedded-mono/sample_names.py --build /tmp/new-embedded-mono --output /tmp/new-embedded-samples
```

Requires the installed Mono runtime at `/usr/lib/libmonosgen-2.0.so`, mcs, gcc/g++ and perf. The host embeds Mono directly; `MONO_ENV_OPTIONS=--jitmap` is present in every fixture child but the Mono launcher is never used. With the helper absent there is no map. The helper registers callbacks after runtime initialization, creates only `/tmp/perf-<pid>.map` with O_EXCL/O_NOFOLLOW/0600 and appends names. A deliberate missing-export build emits one diagnostic and leaves the host running. Each fixture's own map is removed only after its observed normal exit.

The naming runner reports the JIT address/size of the known hot method independently, so anonymous raw instruction pointers can be counted in both modes. It records full-stack output from the existing decoder format and a separate raw-leaf diagnostic (`perf script -G`). These are different gates. On this fixture the raw-leaf diagnostic gives 0% / 100% named known-method weight without/with the map; full-stack DWARF output omits that method in both modes, so the unchanged decoder naming gate is FAIL. No product workaround or decoder change was built.

Matched overhead is five alternating helper/no-helper pairs, 20,000 hot-method invocations per child, measured by the host around mono_jit_exec. It includes execution/JIT and excludes initial host setup; no collector is running. Median, min/max slowdown and every observation are retained. This is descriptive fixture evidence, not a no-overhead guarantee.

Production work still needs hardened callback/initialization lifetime handling, bounded names and writes, supported architectures/exports, explicit configuration/launch ownership, manifest helper provenance, attach isolation and cleanup qualification. No global LD_PRELOAD setting, runtime option mutation, network lookup or attach-time injection is introduced.
