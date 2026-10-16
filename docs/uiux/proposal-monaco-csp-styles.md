# Monaco runtime styles under the embedded CSP

**Roadmap track:** Phase 3.x editor reliability and Phase 3.5 profiling UI.

**Status:** Proposal only, updated 17 October 2026. User approval required before any
CSP configuration change. `src-tauri/tauri.conf.json` remains unchanged.

The independent Opus 5.5 review supplied by the user reports runtime
`style-src-elem` violations in the embedded Tauri build. Tauri adds nonce/hash
sources to the style policy, so the existing `'unsafe-inline'` no longer
authorizes Monaco's dynamically created style elements. This affects syntax
colours and icon styles, including when an editor is open. The browser fixture
does not exercise the embedded policy. The fresh embedded harness run also
records inline `style-src-elem`/`style-src-attr` violations; see the
[repair report](../bugs/16-10-2026/unity-profiling-final-report.md).
Profiler controls now use inline SVG
presentation attributes and require no font or runtime stylesheet.

## Proposed option, not applied

Keep every existing CSP directive and add only:

```json
"app": {
  "security": {
    "dangerousDisableAssetCspModification": ["style-src"]
  }
}
```

This prevents Tauri from injecting sources into `style-src`; the existing
`style-src 'self' 'unsafe-inline'` would then allow Monaco's runtime style
elements. Script policy, script nonce/hash injection, IPC permissions and the
remaining directives stay unchanged. Do not set this option to `true`, which
would disable all asset CSP modification.

The trade-off is that any HTML/style injection in the webview could insert
arbitrary inline CSS, including misleading overlays or altered controls. This
is a reduction in style-injection protection, even though it does not directly
authorize arbitrary scripts. The option name deliberately signals that risk.

A stricter alternative is to supply the current trusted nonce to every Monaco
style creation path, including worker/editor/theme paths, or adapt the editor
to use approved external styles. That preserves the nonce policy but requires
version-specific Monaco integration and proof that every runtime style is
covered. Static icon CSS alone does not fix dynamic token/theme styles.

Before approval, review both approaches with the user. After approval, test an
embedded cold start, opening and changing files, theme/token colouring, hover
and completion widgets, worker errors and recorded CSP violations. Confirm
that script policy did not change. Browser dev-mode success is insufficient.

Sources: [Tauri security configuration](https://v2.tauri.app/reference/config/#securityconfig)
and the installed `@tauri-apps/cli/config.schema.json` description of
`dangerousDisableAssetCspModification`.

---

*Last updated: Phase 3.x / 3.5, 17 October 2026. Author: ShinkuKira21.*
*This document is a plan.*
