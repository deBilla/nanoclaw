# Wiki Skill

You maintain a persistent research wiki for Dimuthu. The wiki lives at `/workspace/group/wiki/` and raw sources at `/workspace/group/sources/`.

## Three Layers

- **`/workspace/group/sources/`** — raw, immutable sources (articles, PDFs, images, text files). Read but never modify.
- **`/workspace/group/wiki/`** — LLM-maintained markdown pages (summaries, entity pages, concept pages, comparisons, syntheses). You own this entirely.
- **Schema** — this SKILL.md plus the wiki section in CLAUDE.md. This is what makes you a disciplined wiki maintainer.

## Three Operations

### Ingest

When the user provides a source (URL, PDF, image, file, text):

1. **Save to sources** — download or copy to `/workspace/group/sources/` with a meaningful filename
   - URL/webpage: `curl -sLo sources/filename.html "<url>"` (or use `agent-browser` for JS-heavy pages). For PDFs: `curl -sLo sources/filename.pdf "<url>"`
   - Do NOT use WebFetch for wiki ingestion — it returns summaries, not full content
2. **Read fully** — read and understand the complete source
3. **Discuss with user** — briefly share key takeaways and what you plan to integrate
4. **Update wiki pages** — create or update all relevant pages:
   - Summary page for the source itself
   - Entity pages (people, organizations, products, technologies mentioned)
   - Concept pages (ideas, frameworks, patterns)
   - Cross-references between related pages
   - Comparison tables if multiple items are being contrasted
5. **Update index** — add/update entries in `wiki/index.md` with one-line summaries
6. **Update log** — append `## [YYYY-MM-DD] ingest | <source title>` to `wiki/log.md`

**One source at a time.** If multiple files are provided, fully complete steps 1–6 for the first before touching the second. Never batch-read all sources first.

### Query

When the user asks a question:

1. Read `wiki/index.md` to identify relevant pages
2. Read those pages in full
3. Synthesize an answer with citations to wiki pages
4. If the answer is novel synthesis worth keeping, file it as a new wiki page (type: `exploration`)
5. Update log: `## [YYYY-MM-DD] query | <question summary>`

### Lint

When asked to lint (periodic health check or manual request):

1. Read `wiki/index.md` in full
2. Scan for:
   - Pages with no inbound links (orphans)
   - Contradictions between pages (flag with `> ⚠️ Contradiction:` in both pages)
   - Stale claims that newer sources have superseded
   - Important concepts that appear across many pages but lack a dedicated page
   - Missing cross-references between clearly related pages
   - Gaps — topics the user clearly cares about but the wiki doesn't cover
3. Report findings and offer to fix each issue
4. Update log: `## [YYYY-MM-DD] lint | Health check`

## Page Format

Wiki pages are markdown files. Use this frontmatter:

```yaml
---
type: summary | entity | concept | comparison | exploration
sources: [filename1.pdf, article-title.html]
updated: YYYY-MM-DD
related: [other-page.md, another-page.md]
---
```

Keep pages focused and linkable. Prefer many targeted pages over one giant document. Cross-link liberally using `[Page Title](page.md)`.

## Source Type Handling

- **URLs**: Download with `curl -sLo` or use `agent-browser` for JS-heavy pages. Never just WebFetch.
- **PDFs**: `curl -sLo sources/file.pdf "<url>"` then read the file — Bun can read PDFs via the Read tool in the container.
- **Images/screenshots**: Save to `sources/`, use vision to extract text and interpret diagrams. Note image content directly in the wiki page.
- **Plain text/markdown**: Copy to `sources/` with descriptive filename, then ingest normally.

## File Naming

Sources: `YYYY-MM-DD-descriptive-slug.ext` (e.g., `2026-04-28-attention-is-all-you-need.pdf`)
Wiki pages: `kebab-case-title.md` (e.g., `transformer-architecture.md`)
Subdirectories: organize by topic as the wiki grows (e.g., `wiki/ml/`, `wiki/companies/`)
