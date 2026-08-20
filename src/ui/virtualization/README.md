# Virtualization boundary

This directory contains virtualization mechanisms only. Feature policy, card
preview, Obsidian interactions, pagination, and two-hop section composition do
not belong here.

## Dependency direction

```text
model
    ↓
engine
    ↓
viewport
    ↓
runtime
    ↓
features/card-grid and features/two-hop
```

Feature code imports the supported surface from `public.ts`.
Virtualization code must not import `features/card-grid`, `features/two-hop`,
`obsidian`, preview runtime, interaction dispatchers, or pagination.

## State ownership

- `model/` contains immutable vocabulary: row ranges, revisions, and layouts.
- `engine/snapshotComputation.ts` computes snapshots without DOM or Svelte.
- `engine/virtualizer.ts` owns snapshots and resident physical row slots.
- `grid/` contains only reusable grid geometry.
- `runtime/measurementScheduler.ts` owns task priority, cancellation, and retry.
- `runtime/scrollCoverageController.ts` owns the published coverage interval.
- `runtime/useVirtualizer.svelte.ts` owns Svelte publication and composition.
- `viewport/observer/scrollSession.ts` owns scroll start/idle transitions.
- `viewport/observer/scrollCoverageGate.ts` owns the open coverage interval.
- `viewport/observer/measurementDispatch.ts` owns observer measurement dispatch.
- `viewport/observer/scrollerRegistry.ts` owns shared observer registration.
- `viewport/observer/observeVirtualViewport.ts` is the DOM observation facade.

## Performance invariants

- Logical identity and physical slots remain separate.
- A covered scroll position does not schedule another scroll measurement.
- Layout work supersedes queued scroll work.
- Resident row shells are reused while their slot-binding revision is compatible.
- Scroll activity defers structure-driven layout work until idle.

Structural refactors must preserve the contracts in `PERFORMANCE.md` and the
DOM/performance tests.
