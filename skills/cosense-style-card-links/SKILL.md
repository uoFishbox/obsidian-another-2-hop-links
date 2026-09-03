---
name: cosense-style-card-links
description: Use the Cosense-style Card Links CLI for Obsidian to inspect or search 1-hop and 2-hop notes, show related-note cards, or replace link targets without renaming notes. Use the standard Obsidian CLI for ordinary reading, editing, and vault-wide search.
---

# Cosense-style Card Links CLI

Use the `cosense-style-card-links` Obsidian CLI extension. No other Obsidian skill is required.

## Setup

The Obsidian desktop app, its CLI, and this plugin must be active for the target vault. See the [Obsidian CLI documentation](https://help.obsidian.md/cli) for setup.

Specify the vault before the command. Replace all sample names and paths:

```sh
obsidian vault="MyVault" cosense-style-card-links
obsidian vault="MyVault" help cosense-style-card-links:list2hopLinks
```

The first command returns the registered commands and arguments as JSON. Inspect it and the relevant `help` output; never guess commands.

Use `key=value` arguments and valueless Boolean flags such as `or` and `dryRun`. Quote values containing spaces.

`path`, `from`, and `to` require exact vault-relative paths, including `.md`, with `/` separators. There is no `file=` resolution or active-note fallback. Reject absolute paths, `..`, and hidden directories.

## Commands

Run commands as `obsidian vault="MyVault" cosense-style-card-links:<command>`.

| Command | Purpose | Arguments |
| --- | --- | --- |
| `list1hopLinks` | Unique outgoing and incoming links | `path` |
| `list2hopLinks` | Notes sharing a link target | `path` |
| `search1hopLinks` | Search 1-hop titles and content | `path`, `query`, optional `or` |
| `search2hopLinks` | Search 2-hop titles and content | `path`, `query`, optional `or` |
| `inspectPage` | Page content, embeds, and both hop groups | `path` |
| `openRelatedPagesView` | Related-note cards in a new tab | `path` |
| `replaceLinks` | Replace link/embed targets without renaming notes | `from`, `to`, optional `dryRun` |

Use standard Obsidian CLI commands for other work:

- `read`: content only
- `search` / `search:context`: vault-wide search
- `links` / `backlinks`: one link direction
- `create`, `create overwrite`, `append`, `prepend`, `delete`, `rename`, `move`: file changes

Check standard arguments with `obsidian help <command>`.

## Related notes

1-hop is the union of outgoing and incoming links. `links1hop[].relation` is `outgoing`, `incoming`, or `bidirectional`.

2-hop is specifically **A -> B <- C**: C links to a target B that A also links to. Results exclude A and its direct 1-hop notes, deduplicate C, and expose B as `links2hop[].via`. It is neither arbitrary graph distance two nor A -> B -> C.

B may be unresolved. `persistent: false` means no readable file exists. Use standard `read` only with a `persistent: true` result's `path`.

```sh
obsidian vault="MyVault" cosense-style-card-links:inspectPage path="Notes/Example.md" limit=20
obsidian vault="MyVault" cosense-style-card-links:list2hopLinks path="Notes/Example.md" limit=20
obsidian vault="MyVault" cosense-style-card-links:search2hopLinks path="Notes/Example.md" query="design validation" or
```

`inspectPage` and the four list/search commands accept `limit=1..1000` (default `100`), `offset` (default `0`), and `sort=title|updated|created` (default `title`; newest dates first).

`count` is the total before pagination. To continue, reuse the same conditions with `offset=pagination.nextOffset`; `null` ends the results. `inspectPage` paginates `relatedPages.oneHop` and `relatedPages.twoHop` independently. Vault changes may alter later pages.

Search splits `query` on whitespace and matches literal terms case-insensitively across title and content. It defaults to AND; `or` selects OR. Terms may match across both fields. Obsidian search operators are unsupported. Unresolved links match titles only.

For page-plus-relations requests, start with `inspectPage` and inspect `page.content`, `page.embeds`, and both hop groups. Report note `path` plus the 1-hop direction or 2-hop `via`. Use `openRelatedPagesView` only when the user asks to see cards.

In `page.content`, `<obsidian:file ... />` and `<obsidian:url ... />` represent separately inspectable embeds, not body text. Use `page.embeds` fields `type`, `path` or `url`, and `embeddedFrom`; open the corresponding image/PDF modal only when needed. Do not open a local embed with `resolved: false`. `original` is the original Markdown syntax; use `read` for complete editable source.

HTTP(S) Markdown images also become `<obsidian:url>`; extensionless image URLs use `type: image/*`. Image syntax inside code is not an embed.

## Replacing link targets

`replaceLinks` scans candidate sources across the entire vault and cannot be limited to a note or folder. For a narrower request, proceed only if every result stays within scope.

Always run the exact replacement as a dry run first:

```sh
obsidian vault="MyVault" cosense-style-card-links:replaceLinks from="Notes/Old.md" to="Notes/New.md" dryRun
```

- `updated`: affected paths; during dry run these are planned, not saved.
- `linkCount`: affected links and embeds.
- `failed`: failed files and reasons.

If replacement was requested and all results are in scope, rerun without `dryRun`. For inspection-only requests, report and stop. If any result is out of scope, report it and ask before writing.

```sh
obsidian vault="MyVault" cosense-style-card-links:replaceLinks from="Notes/Old.md" to="Notes/New.md"
```

After writing, inspect all three result fields and verify representative `updated` files with `read`.

Rules and failure conditions:

- Never rename, move, delete, merge, or create the old or new notes.
- Only body links/embeds recognized by Obsidian's cache are changed. Code, plain text, frontmatter links, and tags are excluded.
- Headings, block references, and aliases remain. `[[Old]]` may become `[[New|Old]]`; verify the target, not display text. Existing targets follow Obsidian's link-format setting; unresolved targets use WikiLinks.
- Dry run does not reserve changes. The write reevaluates the vault, so cache mismatches or intervening edits can fail per file.
- Partial success is possible. Always inspect both `updated` and `failed`; do not assume rollback. Check current files before retrying.

## Responses and errors

Handlers return JSON. Check `ok`, not only the exit code. Obsidian may reject invalid arguments before the handler and return non-JSON errors.

- `invalid-params` / `not-found`: verify arguments and exact paths.
- `not-ready`: retry after initial indexing.
- `conflict`: report `updated` and `failed` separately.
- `cancelled`: check plugin disable/reload and report partial `details.updated` / `details.failed`.
- `io-error`: report the cause; do not assume nothing was written.

Do not repeat a failure without a state change. After empty or unparseable write output, inspect current files before continuing.
