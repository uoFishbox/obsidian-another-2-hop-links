# Shadow DOM hover popovers

Shadow DOM anchors cannot be passed directly to Obsidian's light-DOM hover popover path. This feature keeps one bridge-owned session per ShadowRoot and exposes a hidden light-DOM geometry proxy for the currently relevant anchor.

## Runtime flow

`shadowHoverPopoverBridge.ts` delegates ShadowRoot input events and owns modifier-edge detection. It resolves the current interaction and calls `ShadowHoverControllerImpl` only when hover work is required.

`controller.ts` owns the high-level flow: anchor enter/sync/leave, handoff, relaunch throttling, and launch requests. The production launch callback is defined at the bridge boundary and triggers Obsidian's `hover-link` event directly.

`session.ts` is the single owner of runtime hover state: active anchor, accepted popover, request sequence, pending handoff, anchor-hover membership, proxy store, listener teardown state, timers, and position-patch ownership. `popoverBinding.ts` is the Obsidian adapter that binds anchors, wraps `popover.position`, and attaches native hover listeners; it receives session synchronization callbacks instead of owning parallel state. State is updated directly; there is no parallel lifecycle reducer or registry layer.

`geometry-proxy.ts` only maps Shadow DOM elements to non-interactive light-DOM geometry targets. `debug.ts` contains optional diagnostics. `internal-types.ts` contains the duck-typed Obsidian/session shapes shared by those modules.

## Invariants

- Proxy elements are geometry-only (`pointer-events: none`) and are never activation relays.
- Only `popover.position` is wrapped, so native `transition`, focus, close, hide, unload, timers, and internal popover state remain Obsidian-owned.
- Accepted popovers are matched by monotonically increasing request sequence plus active proxy identity; stale assignments are closed asynchronously.
- Handoff keeps the previous popover until replacement or timeout, then releases it to native lifecycle without forcing close.
- Hover/pointermove state mutation is allocation-free after event resolution: modifier-edge state lives in the bridge and session booleans/sets are updated in place.
- Independent proxy stores remain isolated so one owner cannot release another owner's geometry target.
