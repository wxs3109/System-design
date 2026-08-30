# Content tooling

Scripts that enforce the repo's content hygiene. All are plain Node (no
dependencies) and default to a dry run — pass `--apply` to write changes.

| Script | Purpose |
|---|---|
| `lint-content.mjs` | Checks links, anchors, terminology and list formatting. Exits non-zero on any problem. Runs in CI. |
| `fix-links.mjs` | One-off repair for `] (` spacing and translated link paths. |
| `fix-terms.mjs` | One-off vocabulary normalization. |
| `fix-lists.mjs` | One-off `-Text` -> `- Text` bullet repair. |

## Usage

```bash
node .tools/lint-content.mjs        # check (this is what CI runs)
node .tools/fix-links.mjs           # preview
node .tools/fix-links.mjs --apply   # write
```

## What the linter enforces

1. **`dead-link`** — every relative link target resolves to a real file or directory.
2. **`anchor`** — `#fragments` are slugified (lowercase, no spaces) and match a real heading.
3. **`link-space`** — no space between `]` and `(`; GitHub renders those as plain text.
4. **`term`** — the vocabulary declared in the root README "Terminology convention" section.
5. **`list`** — bullets have a space after `-`.

## Notes for future edits

- The root README quotes banned terms as counter-examples ("don't write `water
  level`, write `Watermark`"). Those lines are explicitly protected in both the
  linter and the fixer — that prose *is* the rule.
- `->` is arrow notation used for state transitions and flow sketches. It is not
  a malformed bullet; the list rule only matches `-` followed by a letter.
- Fenced code blocks and YAML front matter are skipped everywhere.
- The banned-term list is the enforcement point for the README's terminology
  convention. When that convention grows, add the term to `BANNED` in
  `lint-content.mjs` so it cannot regress.
