# Virtual List Optimization Summary

This document summarizes the main performance optimizations used by the TwoHop page virtual list and the generic virtual grid list.

## TwoHopLinksPage / TwoHopViewPlanVirtualList

Main files:

- `src/ui/pages/TwoHopLinksPage.svelte`
- `src/ui/pages/twohop/TwoHopViewPlanVirtualList.svelte`
- `src/ui/pages/twohop/useTwoHopViewPlanVirtualList.svelte.ts`
- `src/ui/pages/twohop/twoHopDataIdentityCache.ts`
- `src/ui/pages/twohop/twoHopLayoutPlanCache.ts`
- `src/ui/pages/twohop/twoHopViewPlan.ts`

Optimizations:

- **Stable data identity**
  - Reuses section descriptors and item objects when source data has not changed.
  - Returns the previous descriptor array when all section references are unchanged.
  - Uses stable interaction IDs and item keys.

- **Sparse item creation**
  - Supports `getItem(index)` access so virtual items can be created only when needed.
  - Avoids building full item arrays for large sections when possible.

- **TwoHop-specific view plan**
  - Compiles all sections into one row model with section offsets, row counts, and total height.
  - Resolves visible rows from scroll offsets without scanning all cards.

- **Batched materialization**
  - Materializes only an initial batch of sections/cells.
  - Materializes the rest in idle/background slices.
  - Defers background materialization while scrolling is active.

- **Mounted row rendering**
  - Uses pooled grid rows through `VirtualSurface`.
  - Disables mounted-cell change tracking for this view and renders from mounted rows directly.

- **Lazy interaction descriptor resolution**
  - Does not create item interaction descriptors while mounting or scrolling.
  - Resolves descriptors only when an interaction occurs, then caches the result.

- **Search integration**
  - Uses worker-backed search and filters display data before resolving virtual sections.
  - Preserves descriptor identity across search updates when possible.

## VirtualGridLinkList

Main files:

- `src/ui/components/common/VirtualGridLinkList.svelte`
- `src/ui/components/common/virtual-list/svelte/useFlatVirtualGridList.svelte.ts`
- `src/ui/components/common/virtual-list/row-models/flatVirtualGridRuntimeModel.ts`
- `src/ui/components/common/virtual-list/reconciliation/linkListVirtualLayout.ts`

Optimizations:

- **Viewport-bounded DOM rendering**
  - Mounts only the visible row range plus overscan rows.
  - Keeps DOM size bounded by the viewport, not by total item count.

- **Row and render slot reuse**
  - Reuses physical row slots while scrolling.
  - Keeps render slot indexes bounded to the mounted row pool.

- **Flat runtime memoization**
  - Memoizes the flat logical cell source and row model per list instance.
  - Reuses them when item revision, key revision, pagination shape, and layout are unchanged.

- **Revision controls**
  - Supports `itemsRevision`, `keyRevision`, `itemRenderRevisionToken`, and `getItemRenderRevision`.
  - Callers can force correct reuse behavior when mutating arrays or changing key/render logic.

- **Virtual-list engine fast paths**
  - Reuses previous snapshots when row model, mounted range, and total height are unchanged.
  - Avoids rebuilding mounted cells on no-op measurements.

- **Visibility state delta sync**
  - Updates mounted/preview visibility state by comparing row-range deltas.
  - Avoids full visibility-state rebuilds when only the preview range changes.

- **Optional infinite scroll**
  - Supports button pagination and IntersectionObserver-based infinite scroll.
  - Limits chained automatic page loads per frame sequence.

## Key Difference

`VirtualGridLinkList` optimizes generic flat-grid rendering. It assumes the caller already provides a usable item array and stable revisions.

`TwoHopLinksPage` adds higher-level TwoHop-specific optimizations before rendering: stable section descriptors, sparse item access, batched materialization, and lazy interaction descriptor resolution. These reduce work before the generic virtual rendering layer is reached.
