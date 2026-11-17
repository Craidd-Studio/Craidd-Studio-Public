# Editing and Markdown

Craidd provides source editing, split source views, file tabs and a Markdown Docs
browser with preview/source modes. Source changes use the normal dirty/save and
external-conflict workflows.

## Source and split views

Open a file from the project tree or File Discovery. The explorer context menu's
**Open in Side Window** opens the second source group within the IDE window;
it is distinct from duplicating the whole IDE window.

Views of one file share its model and undo history. Switching to the Profiling
workspace changes presentation, not ownership of your source files.

## Markdown documents

Use the Docs browser or open a Markdown file. **View Source** and **View Preview**
switch between source and rendered content. The editable preview supports bounded
block edits and formatting through the same underlying source model.

Save, undo and conflict resolution apply to the actual Markdown source. Review
complex Markdown after a preview edit; a rendered page is not a separate rich-text
file. HTML/PDF viewers and other proposed formats are not delivered by this feature.

## Preserve file identity

External source opened by a language server is read-only. References previews
are read-only too; open editable project source to change it. The editor must
not save external SDK/package source through another tab's identity.

A repaired buffer-identity issue and pending reload/save races have regression
coverage. Human acceptance remains open. If a tab shows another file's contents,
preserve the affected buffers and report the exact navigation sequence rather
than overwriting the destination to make a conflict dialog disappear.

See [Markdown documentation](https://github.com/Craidd-Studio/Craidd-Studio-Public/blob/master/docs/feats/editor/docs-viewer/README.md)
and [Troubleshooting](Troubleshooting).

---

*Last updated: 17 November 2026. Author(s): ShinkuKira21.*
*This document is a record.*
