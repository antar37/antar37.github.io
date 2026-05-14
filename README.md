# antar37.github.io

Personal site for Alex Tarasiuk, hosted on GitHub Pages.

A static, Notion-styled clone of the original Notion page — moved off Notion to
escape the bot/DDOS traffic that targets Notion-hosted sites. Designed to look
as close to the original as practical.

## Structure

```
.
├── index.html              # Landing page (cover, callouts, Sierra Gorda, posts grid)
├── post.html               # Generic post viewer (?p=<slug>) — renders posts/*.md
├── assets/
│   ├── style.css           # Shared Notion-style stylesheet
│   ├── cover.jpg           # TARASIUK cover photo
│   ├── profile.png         # Circular profile picture
│   ├── sierra-gorda.jpg    # Sierra Gorda de Querétaro photo
│   └── posts/<slug>/...    # Per-post images extracted from Notion
├── posts/
│   ├── index.json          # Auto-generated post list (powers the home page grid)
│   ├── YYYY-MM-DD-<slug>.md
│   └── ...                 # One Markdown file per blog post
├── Alex_Tarasiuk_Resume.pdf
├── scripts/
│   └── fetch-posts.mjs     # One-shot Notion → Markdown importer (Node 18+)
└── .nojekyll               # Skip Jekyll processing on GitHub Pages
```

## Editing content

- **Landing page text / callouts**: edit `index.html` directly.
- **A blog post**: edit the matching file under `posts/`. The front-matter
  block (between `---` lines) controls the title, date, and TLDR shown on the
  home page. After editing, regenerate `posts/index.json` either by hand or by
  re-running the importer.
- **A new blog post**: create `posts/YYYY-MM-DD-your-slug.md` with the same
  front-matter shape as the others, drop any images into
  `assets/posts/your-slug/`, and add an entry to `posts/index.json`.

## Re-syncing from Notion (one-shot)

If you ever update the Notion page and want to re-import everything:

```bash
node scripts/fetch-posts.mjs
```

That hits Notion's public `loadCachedPageChunkV2` / `queryCollection` endpoints,
walks the Posts collection, converts each block to Markdown, downloads embedded
images, and rewrites `posts/*.md` + `posts/index.json`.

## Local preview

```bash
python -m http.server 8000
```

Then visit http://localhost:8000.

## Custom domain

When you're ready to point your domain at this repo, add a `CNAME` file at the
root with just the bare domain (e.g. `alextarasiuk.com`) and configure DNS per
GitHub Pages' instructions.
