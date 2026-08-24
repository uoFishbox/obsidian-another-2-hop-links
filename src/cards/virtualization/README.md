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
cards/grid and two-hop
```

Feature code imports the supported surface from `public.ts`.
Virtualization code must not import `cards/grid`, `two-hop`,
`obsidian`, preview runtime, interaction dispatchers, or pagination.

## State ownership

- `model/` contains row-range behavior and immutable virtualization vocabulary.
- `engine/snapshotComputation.ts` computes snapshots without DOM or Svelte.
- `engine/virtualizer.ts` owns snapshots.
- `engine/mountedGridRows.ts` owns mounted rows and resident physical row slots.
- `grid/layout.ts` contains reusable flat and sectioned grid geometry.
- `runtime/measurementLifecycle.ts` owns measurement types, task scheduling,
  initial stabilization, published coverage, and the measurement epoch.
- `runtime/useVirtualizer.svelte.ts` owns Svelte publication and composition.
- `viewport/measurement.ts` owns DOM metric reads and stability checks.
- `viewport/observer/scrollMeasurement.ts` owns scroll sessions, the coverage
  gate, observer measurement dispatch, and their shared state contract.
- `viewport/observer/observerDependencies.ts` owns dependency discovery,
  shared resize registration, and structure-mutation filtering.
- `viewport/observer/scrollerRegistry.ts` owns shared observer registration and
  exposes the DOM observation facade.

## Performance invariants

- Logical identity and physical slots remain separate.
- A covered scroll position does not schedule another scroll measurement.
- Layout work supersedes queued scroll work.
- Resident row shells are reused while their slot-binding revision is compatible.
- Scroll activity defers structure-driven layout work until idle.

Structural refactors must preserve the contracts in `PERFORMANCE.md` and the
DOM/performance tests.
