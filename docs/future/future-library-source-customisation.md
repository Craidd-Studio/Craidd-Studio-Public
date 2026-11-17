# Future design: editable copies of external library source

Status: proposal for discussion; not implemented.
Owner: ShinkuKira21 (user-proposed direction).
Date: 16 November 2026.
Integrated into docs/future with user authorisation at the human-checklist handoff.
Original draft retained in /tmp/craidd-human-checklist-findings/.

## Problem and intent

Go to Definition can open external library source supplied by a language server.
These documents must remain read-only when they are not owned editable project
files. In the human checklist, navigating to Rust HashMap showed:
“Read-only: opened by navigation from a language server. Craidd never saves it.”

The user suggested an action along the lines of “Need to edit this library?
Press to fork it.” The intended outcome is an explicit editable copy that the
project actually uses, rather than editing a read-only view or silently changing
a shared package cache. This is future work, separate from Alpha acceptance.

## Terminology and UI

Use “Fork or use a local copy…” as an entry point, not a promise that every
source location can be replaced. A local copy and a hosted Git fork are different
operations; the initial feature need not create a remote repository.

Keep source inspection read-only. The action opens a review workflow showing:

- Which package, version, project and dependency declaration are involved.
- Whether the dependency is direct, transitive, workspace-managed or part of
  the toolchain/standard library, and the evidence for that classification.
- Where an editable copy would live and where its source comes from.
- The exact manifest/workspace override and any lockfile changes proposed.
- Which builds/configurations would use the replacement and how to undo it.
- Whether restart/reindexing is needed and how success will be verified.

Unknown provenance or unsupported replacement mechanisms must produce a clear
explanation, not a guessed dependency rewrite. A language-server source path
alone does not establish a replaceable package identity.

## Source classes and supported routes

### Editable project source

Offer Open editable source, focusing an existing tab at the right location.
No fork or dependency override is needed.

### Third-party dependencies with supported override mechanisms

Where the ecosystem provides a valid project-local source override, propose a
local editable copy plus the appropriate declaration change. Identify the
owning manifest and affected workspace scope first. Support must be qualified
per ecosystem and dependency type; this document does not prescribe a generic
rewrite or claim that any package can be overridden by any project.

A language-neutral UI can delegate the actual operation to an explicit supported
provider/tool. Craidd discovers installed tools and delegates; it does not
bundle tools or silently install them. Ecosystem-specific capabilities must be
declared and verified, not inferred from file extensions alone.

### Standard-library or toolchain source

Rust HashMap is part of the standard library. An editable copy of its source
file is not automatically a replacement for std::collections::HashMap.
Do not offer an ordinary dependency override or imply the IDE can globally
substitute this definition. Explain the restriction. A project-owned alternative
implementation would require explicit imports/API changes and is a separate
workflow. Custom-toolchain work, if ever supported, needs its own design and
qualification.

### Generated, virtual, unmapped or unavailable source

Explain why no supported editable replacement can be established. Permit
inspection/documentation navigation without offering a misleading action.

## Proposed lifecycle

1. Resolve source provenance and the dependency declaration without mutation.
2. Present supported routes and affected project/workspace scope.
3. Prepare a concrete preview: destination, source acquisition, manifest changes,
   tool commands, expected lockfile effects, verification and rollback.
4. Require an explicit user action before copying/fetching source or applying
   project changes. Creating/publishing a remote fork is a separately authorised
   action, never implicit in opening source.
5. Apply the approved operation visibly and log actions in Output. Preserve
   original dependencies and user edits; do not edit shared SDK/package caches.
6. Refresh/restart affected language-server sessions deliberately, then verify
   that navigation and builds resolve the intended replacement. IDE resolution
   and build resolution must agree before reporting success.
7. On partial failure, show what changed and offer a scoped recovery. Rollback
   must preserve subsequent user edits and must not blindly restore an old
   manifest or lockfile over newer work.

## Unsaved buffers and the current testing policy

Do not discard an external-source view or dirty project buffer during setup.
Use the agreed editor/disk/build conflict policy from the human findings report.
A dependency rewrite must not silently retarget diagnostics or a running debug
session to a different source identity.

During active human testing, draft outside the watched repository to avoid
triggering Tauri rebuilds. This copy was explicitly authorised at the handoff;
future live acceptance rounds must preserve that separation.

## Acceptance criteria for a future implementation

- Read-only external navigation remains read-only before and after cancellation.
- Unsupported standard-library source explains the restriction without claiming
  an ordinary fork can replace it.
- A supported dependency override shows the complete affected declaration scope
  and requires explicit user action.
- Builds and language-server navigation demonstrably use the chosen copy.
- Shared caches/SDKs and unrelated projects remain untouched.
- Acquisition, permission, build and reindex failures have visible recovery.
- Undoing the configuration preserves edits made to the local library copy.

## Open design questions

- Which ecosystem/provider and dependency class should be qualified first?
- How should transitive overrides and multi-project workspace scope be reviewed?
- How are provenance, licensing and version-update information retained with
  the copy, without claiming automatic compatibility?
- Should remote-fork creation be supported later through a connected service?
- How should the existing Documentation Browser expose this action alongside
  symbol docs and Go to Definition, without confusing docs with source editing?

*Last updated: future design discussion, 16 November 2026. Author(s): ShinkuKira21.*
*This document is a design.*
