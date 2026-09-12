# Two-hop virtual grid

Feature layer that compiles two-hop sections into the shared virtualization
runtime. `cards/virtualization` owns the algorithms; this directory owns
two-hop geometry, policy, and DOM bindings.

## Dependency direction

```text
layout + cellKeys
        ↓
rowModel
        ↓
navigation

useTwoHopVirtualGrid (composition root)
    ├── twoHopCardSurfaceRuntime → cardHydrator → mountedCardBindings
    ├── mountedRows
    └── anchorRestoration → layoutAnchor
```

## State ownership

- `layout.ts` owns grid geometry resolution, defaults, and equality.
- `cellKeys.ts` owns the logical-key format and parsing.
- `rowModel.ts` compiles sections into virtual rows; geometry only.
- `navigation.ts` owns keyboard/focus policy over any navigation grid.
- `layoutAnchor.ts` owns DOM scroll capture/restore primitives.
- `anchorRestoration.ts` owns the pending-restore state machine used after
  section or layout publications.
- `mountedRows.ts` and `mountedCardBindings.ts` map virtual cells to resident
  DOM rows.
- `cardHydrator.ts` owns bounded hydration, priority queues, and the retained
  card-model cache.
- `twoHopCardSurfaceRuntime.ts` composes hydration, preview ranges, and
  physical-slot interactions.
- `useTwoHopVirtualGrid.svelte.ts` is the composition root consumed by
  `TwoHopVirtualGrid.svelte`.

## Invariants

- Logical keys are only built and parsed through `cellKeys.ts`.
- `rowModel.ts` never touches the DOM; `anchorRestoration.ts` never rebuilds
  the row model.
- Header focusability is defined once in `navigation.ts`.
