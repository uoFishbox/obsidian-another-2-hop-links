# Two-hop virtual-list performance contract

This document records the structural performance baseline for the two-hop
virtual grid. The shared contracts in
`src/cards/virtualization/PERFORMANCE.md` remain authoritative.

## Pipeline

```text
sections + layout -> TwoHopRowModel -> shared range engine
                  -> mounted two-hop rows -> shared physical slot pool
                  -> retained Svelte cell bodies
```

`TwoHopRowModel` owns section geometry, logical cells, visible-range lookup,
and navigation. `mountedRows.ts` binds only rows entering the resident window
to physical slots supplied by the shared allocator. `CardGridSurface` publishes
those immutable bindings into stable row and cell signals.

Preview and hydration work runs after the mounted snapshot is published.
`twoHopCardRuntime.ts` rebuilds foreground/background queues in one pass over
the mounted rows and owns the bounded off-window model cache, preview binding
invalidation, and physical-slot interaction bindings. There is no intermediate
demand object between mounted rows and the hydration queues.

Demand publication rebuilds the foreground/background queues in reused storage
from current pending keys. Cancelled cells and obsolete priority entries must
not survive until an idle drain; queued work is bounded by current demand even
when idle work is withheld across many scroll windows.

Layout anchors are captured before geometry changes and restored after the
committed content height reaches the DOM. Intervening publications share the
first anchor. Restoration reads the actual scroll delta, respects user scrolling
and scroller changes, and republishes ranges from the resulting scroll position.

## Owners and invalidation

| State                                  | Owner                          | Invalidation                              |
| -------------------------------------- | ------------------------------ | ----------------------------------------- |
| Section geometry and logical cells     | `TwoHopRowModel`               | sections or layout change                 |
| Mounted ranges and immutable snapshots | shared virtualizer engine      | range or row-model change                 |
| Logical-row to physical-slot mapping   | shared resident row allocator  | range or column topology change           |
| Reactive row/cell shells               | shared physical grid slot pool | capacity growth or column topology change |
| Hydrated card models                   | `twoHopCardRuntime.ts`         | item/revision change or bounded eviction  |
| Preview bindings and demand queues     | `twoHopCardRuntime.ts`         | coalesced post-paint range effect         |

## Required hot-path properties

- An unchanged measurement reuses the complete snapshot and mounted build.
- A one-row shift resolves and binds only the entering logical row.
- Retained logical rows keep their row objects and physical slots.
- Mounted DOM and row/cell shell counts are bounded by the resident range.
- `previewVisible` remains inside `mounted`.
- Scrolling does not rebuild section geometry or enumerate all section items.
- Range scans use direct loops over `rowsInMountedRange`; they do not create a
  flattened mounted-cell array, iterators, or chained `map`/`filter` results.
- A range update rebuilds hydration queues in a single pass over the mounted
  rows; it neither materializes a demand object nor rescans for queue setup.
- Preview bindings are reused while their inputs are unchanged, so a
  visible-range-only change does not rescan mounted cards for previews.
- Visibility-policy objects are memoized by row stride.
- Scratch storage owned by allocators, schedulers, and slot pools is reused
  across scroll frames.
- Published snapshots and mounted builds are immutable. Mutation remains local
  to allocator, scheduler, cache, and Svelte slot-pool state.

Refactors may move these responsibilities between files without adding
per-frame controller objects, callback closures, parameter objects, row/cell
shells, or intermediate collections.

## Verification

The unit, DOM, and performance-contract suites cover bounded residency,
no-op reuse, sustained one-row shifts, jumps, pool growth, column changes,
preview demand publication, and retained DOM/component identity. Performance
tests use structural counters and reference identity rather than wall-clock
thresholds.

For changes to the scroll hot path, run `bun run check`, the relevant flat and
two-hop DOM suites, and `bun run test:perf`. Compare production allocation
profiles when introducing or changing a collection, callback, or cache.
