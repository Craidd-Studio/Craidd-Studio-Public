# Contributing

Developers, testers, designers and technical writers are welcome. Useful
contributions include focused fixes, reproducible bugs, clearer user guides,
accessibility findings and test evidence with precise scope.

## Discuss and implement

For a substantial change, use [GitHub Issues](https://github.com/Craidd-Studio/Craidd-Studio-Public/issues) to discuss the problem,
proposed behavior and trade-offs. Read [AGENT.md](https://github.com/Craidd-Studio/Craidd-Studio-Public/blob/master/AGENT.md) and the
[working protocol](https://github.com/Craidd-Studio/Craidd-Studio-Public/blob/master/docs/working-protocol.md) before changing code or
architecture. Preserve user work and existing design/evidence attribution.

Keep source and generated files distinct. Craidd discovers/delegates to external
tools; do not silently install tools, rewrite user manifests or change process
ownership to make a test pass. Project creation has its own explicit scaffolding
boundary.

## Validate the relevant scope

For a source checkout, `npm run build` checks the frontend and
`node --test tests/*.test.mjs` runs the Node regression files. Rust library tests
run from `src-tauri/` with `cargo test --lib`. Native/display/tool-backed cases
have additional prerequisites; preserve failures, ignored cases and unrun gates.

Use the existing disposable UI/Unity harness for runtime work and read its
[isolation and execution instructions](https://github.com/Craidd-Studio/Craidd-Studio-Public/blob/master/tests/ui/README.md). Do not drive,
restart or clean a user's active Editor/project as a convenient fixture.

## Report an issue

Include commit/build identifier, Linux distro/desktop, language and tool versions,
solution/configuration, minimal steps, expected/observed behavior and a redacted
log or screenshot when useful. Distinguish a source inspection, automated result
and human observation. Never publish tokens, private source or a home/profile dump.

## Documentation and wiki

User guides live here; technical designs and exact evidence live in the source
repository. Keep links on the actual `master` branch and check that a described
capability is implemented, experimental or planned. A build passing on one host
is not a universal release claim.

The project uses the [Apache 2.0 license](https://github.com/Craidd-Studio/Craidd-Studio-Public/blob/master/LICENSE). Contributions should
preserve existing notices and provenance for third-party code/assets.

---

*Last updated: 17 November 2026. Author(s): ShinkuKira21.*
*This document is a record.*
