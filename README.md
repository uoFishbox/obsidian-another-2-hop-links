# Cosense-style Card Links

Render Obsidian links as Cosense-style preview cards and explore your vault through two-hop link navigation.

## Features

- **Cosense-style card links** — See linked notes as visual preview cards with excerpts, titles, and metadata.
- **Two-hop links** — Discover notes that are two links away from the current note.
- **Backlinks & outgoing links** — Browse incoming and outgoing references in a unified card layout.
- **Tag notes view** — Open any tag as a card grid of matching notes.
- **Display modes** — Choose between a separate view, inline below the editor, or a hybrid layout.
- **Search & filter** — Quickly filter cards by keyword.
- **Keyboard navigation** — Move through cards without leaving the keyboard.
- **Hover previews** — Preview a note in a popover by hovering a card.
- **Unresolved note creation** — Create missing notes directly from unresolved links.
- **Canvas integration** — Follow selected canvas nodes and drop cards onto the canvas.
- **Customizable appearance** — Adjust card size, gaps, columns, preview length, and more in settings.

## Usage

- Open the **Two Hop Links** view from the command palette or sidebar.
- Use the plugin settings to choose your preferred display mode and card style.
- Click a card to open the note, or hover for a quick preview.
- Use the search box and keyboard shortcuts to navigate large collections.

## Development

```bash
bun install
bun run dev
```

Run tests:

```bash
bun run test
```

Build and publish the version from `manifest.json` as a GitHub release:

```bash
bun run release
```

The command requires an authenticated GitHub CLI (`gh auth login`) and uploads
`main.js`, `styles.css`, and `manifest.json`.

## License

MIT
