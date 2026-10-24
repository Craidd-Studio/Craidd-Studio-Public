# GR-002 correctness: retain sampled leaves when unwinding fails

**Status:** accepted for implementation after the metric-editor quality pass, before GR-003 and GR-004. Local commits only.

The sample's instruction pointer is independent of the unwinder's ability to recover callers. A full-chain `perf script` decode can emit an empty chain even with valid unwind tables and no lost records. Dropping that sample loses self attribution. Increasing the copied stack does not establish a fix.

Decode the same immutable raw capture twice with identical fields: authoritative leaf-only (`script -G`) and call-chain output. Reconcile sample identities using PID, TID, nanosecond timestamp and event period, preserving duplicate identity order and checking leaf IP where a chain supplies one. A missing, mismatched or truncated chain must never erase the authoritative leaf. Never borrow another sample's callers. Bound both decodes and frame interning; report retention limits separately from unwind coverage. Preserve the literal sampled IP even when named frames are interned together.

Self attribution uses every retained authoritative leaf. Inclusive attribution uses only usable chain records. Empty chains contribute zero inclusive weight and remain visible as leaf-only self entries. Truncated recovered chains describe only the callers actually recovered and are labelled partial; no claim of complete unwinding follows from an apparently normal chain. Show sample counts and event weight for empty, truncated, mismatched and available chains per thread and leaf module, plus the selected population and denominators in the trees. Source identity, map provenance, raw hash, scope and reopen checks apply to both decodes together.

Qualify against actual perf output on a normal native fixture and the embedded Mono fixture that defeats unwinding. Authoritative leaf totals must equal retained self totals, including leaf-only samples; compare sample counts and weighted totals. Parser fixtures must cover duplicate timestamps, missing records, truncated chains and mismatched leaf IP. Report LOST independently. No GR-003 symbol-location or GR-004 helper implementation precedes this fix.

---

*Last updated: 24 October 2026. Author(s): ShinkuKira21.*
*This document is a design.*
