# Markdown / Docs: initial implementation

**Roadmap track:** Editor/documentation feature; no debugger or release gate is changed.

**Status:** Implemented in source, 20 October 2026. Automated and browser evidence
is listed below. Native desktop and packaged acceptance remain open.

**Design:** [Markdown preview and documentation browsing](design-markdown-projects.md).
The user selected the initial block-editing approach, with richer visual editing
available as future work if needed. [HTML/PDF viewers](design-html-pdf-viewers.md)
remain separate proposals.

## Using Docs

Select **Docs** in the activity bar. The sidebar discovers `.md` and `.markdown`
files throughout the active folder, including unopened descendants and nested
project folders. Root `AGENT.md` / `AGENTS.md` variants appear first, retaining
their real names and paths. Filtering matches filenames and paths, not content.
Folders without matching documents are pruned.

Open a document in an ordinary editor tab. Markdown defaults to **View Preview**;
**View Source** exposes the complete Markdown through the existing Monaco editor.
A compact `</>` button at the right of the breadcrumb switches to Source; the
eye button there returns to Preview. Both have accessible names and tooltips,
and switching returns keyboard focus to the selected document surface.
The selected view is remembered per file for the current window session. Source
navigation requests, including explicit line navigation, switch to Source.
The side editor group continues to provide the ordinary source editor.

In Preview, double-click or double-tap text to edit its block, or use **Edit**
beside it. Links, buttons and other controls retain their ordinary interactions;
dragging/scrolling does not count as a double-tap. Double-clicking or
double-tapping another block switches editing to it immediately, retaining the
first block's edits and a separate undo boundary. Source ranges are adjusted
when earlier block edits change the document length. This opens that block's exact
Markdown in place. Each keystroke updates the existing document buffer. **Done**,
Escape or Ctrl+Enter finishes block editing. There is no separate draft to apply
before Save or Close. Tables, lists, task checkboxes, code blocks and links can
be changed through their block's Markdown; checkboxes are not direct toggles.
Raw HTML, reference definitions and other non-rendered constructs remain editable
through Source.

Formatting controls provide **Bold**, **Italic**, **Code** and **Link**.
Ctrl+B and Ctrl+I format selections in Preview, block fields and Source.
In rendered Preview, literal text maps to exact source offsets; selecting a word
within a paragraph or link label supports repeated toggling and combined bold
and italic without affecting the sidebar or tabs. Selections that cross hidden
Markdown syntax or cannot map exactly use Edit / Source rather than guessing.
In block fields, Ctrl+K inserts a link with its destination selected. Elsewhere
Ctrl+K retains the IDE's existing chord prefix, including Ctrl+K Ctrl+O.
Outside the document, Ctrl+B
retains its existing sidebar shortcut. Source gives full control over constructs
beyond these helpers.

Preview and Source share one Monaco model, undo history and tab dirty state.
A block edit forms an undo group; Ctrl+Z/Ctrl+Y and Edit-menu Undo/Redo
commands use that history. The source editor stays mounted across view switches,
preserving its cursor and editor state. Existing Save, conflict, dirty-close and
linked-window ownership paths remain in use.

Preview does not serialize the rendered document back to Markdown. Edits replace
only the chosen source range, leaving everything else intact, including reference
definitions, raw HTML, whitespace and literal `+++`. Standard Markdown is the
rendering contract; `+++` compatibility and full rich text editing are deferred.
If Monaco's source differs from the tab buffer, Preview refuses the edit and
asks the user to use Source; it does not silently normalize the document.

Use **Reveal in File Discovery** beside a row to expand its actual location and
access existing create, rename and delete actions. Docs itself provides browsing
and editing only, with no filtered-folder deletion or project/schema mutation.

## Rendering and navigation boundaries

The bundled renderer uses react-markdown, remark-gfm and rehype-highlight:
headings, emphasis, lists, quotes, inline/fenced code, supported language
highlighting, tables, strikethrough, task lists, links, images and footnotes.
Unknown code languages remain readable without highlighting. Typography follows
the editor's light/dark palette, with table and code overflow.

Local Markdown links resolve relative to the current document, open ordinary
IDE tabs, and support heading fragments. Heading IDs use a document-specific
prefix and duplicate handling. Missing files/headings produce visible feedback.
HTTP(S) and mail links use the existing external opener. Other local formats
are delegated to File Discovery; HTML and PDF are not viewers in this slice.

Raw HTML is skipped, unsafe URL schemes cannot invoke IDE actions, and remote
images are not loaded. Offline local raster images (PNG, JPEG, GIF, WebP, AVIF,
ICO and BMP) use a bounded binary IPC read. Canonical targets must be files
inside the active workspace, including after resolving symlinks; the limit is
8 MiB per image. SVG and other assets show an unavailable fallback. Blob URLs
are released when the image changes or unmounts. No CSP expansion is required.

## Discovery implementation

Docs uses the same `read_dir_children` API as File Discovery and inherits its
hidden-file, generated-folder and symlink exclusions. A breadth-first scan uses
at most four in-flight directory requests, 12,000 entries and 64 directory
levels. Limits count all entries, including non-Markdown files. Traversal errors
and limits produce an explicit **Discovery incomplete** state.

The scan yields between batches and stops scheduling work after cancellation.
Results are discarded after view/workspace changes. Refresh, File Discovery's
shared refresh/mutation state and window focus trigger rediscovery. Sidebar
switching retains tree expansion and filtering. There is no independent watcher
or continuously maintained index, and discovery is not claimed complete when
its limits/errors are reported.

## Evidence and remaining acceptance

- `npm run build`: TypeScript and production bundling passed.
- `npm run test:docs`: discovery of unopened folders, filtering/pinning,
  limits/errors/cancellation, encoded local paths and blocked URLs, GFM rendering,
  source ranges and exact untouched-source preservation, heading collisions,
  formatting helpers and independent bold/italic composition passed.
- Rust filesystem tests: shared discovery regressions and document asset
  containment, sibling-prefix and symlink escapes, missing files, raster-only
  policy and image size limit passed.
- `tests/markdownDocs.browser.mjs`: headless Chrome with mocked Tauri IPC tested
  the connected UI, real repository design document, light/dark layouts,
  Preview edits with exact CRLF preservation, formatting, shared undo/redo,
  Source and Preview edits with shared undo/redo, dirty-close protection, save
  conflicts and save, local images, relative links/fragments,
  broken links, unsafe URLs, File Discovery reveal and editing an empty document.
  Mocked IPC is not
  native filesystem or desktop acceptance.

The follow-up `tests/markdownShortcuts.browser.mjs` first reproduced Ctrl+B
hiding the sidebar for a rendered selection. It now passes formatting and
repeated bold/italic toggles in rendered text, link labels and Source, while
checking that the sidebar and tabs remain open and that the sidebar shortcut
still works outside the document. The compact control and serif reading layout
were inspected in light and dark themes. Mouse double-click and touch double-tap
block entry also passed, with no source mutation on entry and single-tap/link
behavior retained. Native shortcut and touch acceptance remain open.

To reproduce the browser check, start `npm run dev` and run
`node tests/markdownDocs.browser.mjs` with Playwright available. The runner
accepts `CRAIDD_PLAYWRIGHT_MODULE` (module entrypoint), `CRAIDD_CHROME` (browser
executable) and `CRAIDD_DOCS_URL` (server URL). Its fixture is test-only and
is not imported by the product entrypoint.

Still verify the running Tauri app and packaged build: native image IPC and
external opener behavior, real filesystem permission failures and changes,
linked-window ownership, side-group edits, workspace switching during a large
scan, keyboard use, and long editing sessions. No live desktop acceptance or
performance savings are claimed.

---

*Last updated: 20 October 2026. Author(s): ShinkuKira21.*
*This document is a record.*
