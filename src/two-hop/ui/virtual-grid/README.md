# Two-hop virtual grid

Feature layer that compiles two-hop sections into the shared virtualization
runtime. `cards/virtualization` owns the algorithms; this directory owns
two-hop geometry, policy, and DOM bindings.

## Dependency direction

```text
layout
  ↓
rowModel (geometry + logical keys + navigation policy)

useTwoHopVirtualGrid (composition root)
    ├── twoHopCardRuntime (hydration queues + card cache + preview + interactions)
    ├── mountedRows
    └── anchorRestoration (capture/restore + pending state)
```

## State ownership

- `layout.ts` owns grid geometry resolution, defaults, and equality.
- `rowModel.ts` compiles sections into virtual rows, owns the logical-key
  format used to address those rows, and defines keyboard/focus navigation
  policy over its own cells.
- `anchorRestoration.ts` owns both DOM anchor capture/restore primitives and
  the pending-restore state machine used after section or layout publications.
- `mountedRows.ts` maps virtual cells to resident DOM rows and keeps the
  `rowModel` identity guard that prevents stale binding reuse.
- `twoHopCardRuntime.ts` owns the latest resident hydration queues, the bounded
  card-model cache, preview binding publication, and physical-slot
  interactions. It rebuilds foreground/background queues in one pass over the
  mounted rows; there is no demand object or intermediate priority array.
- `useTwoHopVirtualGrid.svelte.ts` is the composition root consumed by
  `TwoHopVirtualGrid.svelte`. Preview dependencies come from the shared app
  context (`previewRuntime` / `resolveSearchMatchOffset`), not from a
  two-hop-specific prop bundle.

## Invariants

- Logical keys are created and resolved inside `rowModel.ts`; there is no
  separate key registry or parser state.
- Hydration work is rebuilt from the latest resident rows only; foreground
  demand wins if the same logical key is encountered twice, and superseded
  windows drop their pending work before it drains.
- `rowModel.ts` never touches the DOM; `anchorRestoration.ts` never rebuilds
  the row model.
- Header focusability is defined once in `rowModel.ts`.
- Preview bindings are rebuilt only when hydration, card dimensions, the
  mounted build, or preview activity changes; a visible-range-only change
  republishes the snapshot with the same binding array.
