# Two-hop virtual grid

Feature layer that compiles two-hop sections into the shared virtualization
runtime. `cards/virtualization` owns the algorithms; this directory owns
two-hop geometry, policy, and DOM bindings.

## Dependency direction

```text
layout
  ↓
rowModel (geometry + logical keys)
  ↓
navigation

useTwoHopVirtualGrid (composition root)
    ├── twoHopCardSurfaceRuntime → cardHydrator + mountedCardBindings
    ├── mountedRows
    └── anchorRestoration (capture/restore + pending state)
```

## State ownership

- `layout.ts` owns grid geometry resolution, defaults, and equality.
- `rowModel.ts` compiles sections into virtual rows and owns the logical-key
  format used to address those rows.
- `navigation.ts` owns keyboard/focus policy over any navigation grid.
- `anchorRestoration.ts` owns both DOM anchor capture/restore primitives and
  the pending-restore state machine used after section or layout publications.
- `mountedRows.ts` and `mountedCardBindings.ts` map virtual cells to resident
  DOM rows.
- `cardHydrator.ts` owns the latest resident hydration demand, two bounded
  priority queues, and the retained card-model cache. It does not retain
  pending work from superseded scroll windows.
- `twoHopCardSurfaceRuntime.ts` composes hydration, preview ranges, and
  physical-slot interactions.
- `useTwoHopVirtualGrid.svelte.ts` is the composition root consumed by
  `TwoHopVirtualGrid.svelte`.

## Invariants

- Logical keys are created and resolved inside `rowModel.ts`; there is no
  separate key registry or parser state.
- Hydration work is rebuilt from the latest resident demand only; foreground
  demand wins if the same logical key is encountered twice.
- `rowModel.ts` never touches the DOM; `anchorRestoration.ts` never rebuilds
  the row model.
- Header focusability is defined once in `navigation.ts`.
