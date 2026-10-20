# Docs viewer designs

**Roadmap track:** Future editor/documentation feature, unassigned.

**Status:** Initial Markdown / Docs implementation, 20 October 2026, with
automated and browser checks. Native desktop acceptance remains open; HTML/PDF
remain proposals. See the [implementation record](implementation-markdown-docs.md)
for the delivered scope, controls, evidence and limitations.

The preferred direction is **B: a Docs browser in the activity bar**, backed
by shared File Discovery. It exposes documentation at real paths and opens
documents in the editor area. Viewing documentation requires no new project
declaration. The Markdown interaction is `View Source / View Preview`, with
editing in both surfaces using one document buffer.

## Implementation and designs

- [Markdown / Docs implementation](implementation-markdown-docs.md) explains the
  Docs browser, Source/Preview block editing, formatting shortcuts and evidence.

- [Markdown preview and documentation browsing](design-markdown-projects.md)
  records the preferred B direction, the A docs-project alternative, B0 file
  management choices, editable Preview and optional `+++` compatibility.
- [Potential HTML and PDF viewers](design-html-pdf-viewers.md) explores how
  those formats could share the browser and document tabs while retaining
  their own rendering, editing and implementation requirements.

| Format | Proposed interaction | Design maturity |
| --- | --- | --- |
| Markdown | View Source / View Preview; edit one Markdown block in place | Initial implementation with automated/browser evidence; native desktop acceptance open |
| HTML | Editable Source and isolated rendered Preview | Extension proposal; static document scope and asset handling need agreement |
| PDF | Page viewer with navigation, zoom, selectable text and search where available | Extension proposal; binary loading and renderer need qualification |

The HTML/PDF proposals do not expand the first Markdown delivery automatically.
Format discovery, controls and file actions should match the capability of
the format rather than presenting every document as editable Markdown.
Craidd does not enforce an authoring style or automatically convert files.

The historical designs retain the broader alternatives and future acceptance
checks. The implementation record identifies which choices this first slice
makes and which capabilities remain deferred. Automated/browser evidence does
not establish native desktop acceptance.

See the [project model](../../../craidd-cln-model.md) and
[current roadmap](../../../roadmaps/Roadmap-v0.0.4A.md) for governing context.

---

*Last updated: 20 October 2026. Author(s): ShinkuKira21.*
*This document is a design.*
