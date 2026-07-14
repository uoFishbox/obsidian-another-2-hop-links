# Two-hop virtual-list performance contract

This document is the structural performance baseline for the retained two-hop
virtual list. Refactors must preserve these counters and identity guarantees;
elapsed time is recorded only as a local comparison and is not a CI gate.

## Pipeline

The supported data flow is:

```text
compile plan -> plan mounted-range transition -> commit physical slots
             -> publish atomic bindings -> render retained Svelte bodies
```

Compilation may read section descriptors and item collections. The scroll hot
path must use only the compiled plan and reusable scratch state.

## Owners and lifetimes

| State                           | Owner                                              | Lifetime / invalidation                                                |
| ------------------------------- | -------------------------------------------------- | ---------------------------------------------------------------------- |
| Section and item identity       | page `twoHopSectionDescriptorIdentityCache`        | page instance; reconciled on input updates                             |
| Compiled plan                   | virtual-list `twoHopCompiledPlanCache`             | sections, visible counts, or layout change                             |
| Interaction descriptors         | mounted-surface `twoHopInteractionDescriptorCache` | lazily replaced when item or descriptor revision changes               |
| Row/cell shells and controllers | `twoHopPhysicalSlotStore`                          | mounted surface; resized only when allocator capacity/topology changes |

These caches intentionally remain separate because their owners and
invalidation rules differ.

## CI gates

The perf-contract suites cover 100, 1,000, and 10,000 cards and the following
transitions: 300 one-row scroll shifts, unchanged range, distant jump, pool
growth, sustained under-utilization, same-column resize, and column topology
change.

- After initial allocation, 300 one-row shifts allocate zero row/cell shells.
- An unchanged mounted range performs zero row rebinds, cell rebinds, and
  binding commits.
- A one-row shift rebinds one row and exactly `columns` cells.
- A pool epoch change rebinds the complete mounted range; ordinary shifts do
  not.
- `renderSlotIndex` and `cellSlotKey` remain below `capacity * columns`.
- `previewVisible` is clamped inside `mounted`.
- Scrolling does not call `getItems()`, sort/reconcile items, or compile a plan.
- DOM nodes and compatible item child components survive physical-slot reuse.
- Same-column resize retains the surface and item subtree. Column topology
  changes may reconstruct the keyed surface.
- Interaction descriptors are created on first interaction, then cache hits
  reuse the descriptor while the mounted item and revision remain compatible.

## Diagnostic counters

The relevant development counters are:

- `twoHop.plan.compile`
- `twoHop.physicalPool.resize`
- `twoHop.binding.commit`
- `twoHop.itemBody.mount`
- `twoHop.interactionDescriptorCache.hit`
- `twoHop.interactionDescriptorCache.miss`
- `twoHop.scalarKernel.rowShellCreated`
- `twoHop.scalarKernel.cellShellCreated`
- `twoHop.reboundRowSlot`
- `twoHop.reboundCellSlot`

The checked-in baseline is the contract encoded by the tests rather than a
machine-specific duration. Before the staged refactor, `bun run check`, the 65
two-hop unit/DOM tests, and the 14 two-hop perf tests passed on 2026-07-14.
