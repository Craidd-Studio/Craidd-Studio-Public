# Wiki source pages

This folder contains reviewable Markdown source for the Craidd Studio GitHub
Wiki. It is not automatically synchronized with the wiki's separate Git repository.
The application repository and the wiki have separate Git histories; updating
this folder alone does not publish the wiki.

Start with `Home.md`. Guides use GitHub Wiki page links such as
`[Getting Started](Getting-Started)`. `_Sidebar.md` and `_Footer.md` are rendering
fragments; their names are significant to GitHub Wiki. `README.md` is this local
publishing guide and should not replace the wiki's Home page.

## Review and publish yourself

1. Review the generated guides against current implementation and the release
   index. The release page is a dated snapshot; update it when qualification changes.
2. Clone your wiki's separate repository into a location you choose:

   ```sh
   git clone https://github.com/Craidd-Studio/Craidd-Studio-Public.wiki.git
   ```

3. Compare the existing pages before copying. Keep a commit/backup of your own
   wiki edits. Copy the guide Markdown files and the two navigation fragments
   into that clone; exclude this `README.md`.
4. Inspect the wiki diff, commit your selected changes and push from that wiki
   clone when you are ready. A push to the application's source repository does
   not publish these pages to the wiki.

The existing wiki Home page was read from wiki commit `9991dc5`; this draft
retains its solution-first direction while replacing placeholder guide lists
with navigation and correcting repository links from `main` to `master`.

The repository README links only to the already-existing Wiki home so it does
not depend on these new pages being published first. No ZIP or archive is needed.

---

*Last updated: 17 November 2026. Author(s): ShinkuKira21.*
*This document is a record.*
