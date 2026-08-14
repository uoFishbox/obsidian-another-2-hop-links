# AGENTS.md — Shadow DOM hover popovers

Hover popover implementation that bridges Shadow DOM anchors to Obsidian's light-DOM popover infrastructure.

- **Problem**: Obsidian's `hover-link` workspace event expects a light-DOM anchor element. Elements inside Shadow DOM are not directly usable as popover targets.
- **Solution**: A proxy-anchor system that bridges Shadow DOM anchors to Obsidian's hover popover infrastructure.

## Architecture

| Module                  | Purpose                                                                                                                                           |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `controller.ts`         | Event delegation, lifecycle event dispatch, and side-effect orchestration.                                                                        |
| `geometry-proxy.ts`     | Creates isolated stores of non-interactive light-DOM geometry proxies.                                                                            |
| `launcher.ts`           | Triggers Obsidian's `hover-link` workspace event via a proxy `HoverParent`.                                                                       |
| `registry.ts`           | Adds actual-anchor hover state to a bridge-owned geometry proxy store.                                                                            |
| `state-machine.ts`      | Pure lifecycle reducer (`transitionHoverSession`) plus an in-place interaction reducer (`transitionHoverSessionInteraction`) and state selectors. |
| `session.ts`            | Reducer adapters, target/geometry synchronization, and side-effect resources.                                                                     |
| `internal-constants.ts` | Patch markers and symbol keys for popover monkey-patching.                                                                                        |
| `internal-types.ts`     | Duck-typed Obsidian interfaces and discriminated session state/event types.                                                                       |
| `public-types.ts`       | Public API types for the controller and link resolver.                                                                                            |
| `dom-utils.ts`          | DOM helper utilities.                                                                                                                             |
| `debug.ts`              | Debug logging and session/popover summarizers.                                                                                                    |

> この表はこのディレクトリのファイルと1:1です。ファイルを統合・分割・改名した場合は、同時にこの表も更新してください。

## Key mechanisms

- **Proxy anchors**: Each Shadow DOM anchor gets a hidden proxy `<div>` in `document.body`, positioned to match the actual anchor's screen coordinates. Every proxy is a non-interactive geometry target (`pointer-events: none`) and never overlays or relays input to the actual card. Controller sessions and global target normalization use isolated stores created by the same implementation, so one owner cannot release another owner's proxy.
- **Synthetic hover relay**: Delegated actual-anchor enter/leave sends `mouseover`/`mouseout` to the matching proxy. An accepted popover also schedules one guarded `mouseover` microtask after assignment so derived constructors can finish registering native target listeners. This is the primary target-hover path. Bridge-owned transition requests still synchronize `onTarget` immediately before calling the native method as a construction-timing fallback, but native `transition` calls are never wrapped.
- **Popover patching**: Only `position` is wrapped to refresh proxy geometry. `transition` retains its native function identity; calls initiated by Obsidian or other plugins do not pass through Shadow hover code.
- **Native lifecycle ownership**: `hide`, `close`, `unload`, `detect`, internal timers, focus, and internal popover state are not intercepted or mutated for keep-alive. Releasing an accepted popover sets its Shadow-only `onTarget` information to false, invokes native `transition()`, and then removes bridge-owned patches/references without forcing close.
- **Handoff**: When moving to a new anchor, the old popover is kept until replacement or timeout, then released to its native lifecycle. A focused or pinned popover may remain open independently.
- **Stale detection**: Each launch carries a monotonically increasing sequence number. Stale/unaccepted popover assignments remain bridge-owned and are explicitly closed to prevent leaks.
- **Lifecycle state machine**: `HoverSessionState` is a discriminated union: `idle`, `hovering-anchor`, `opening`, `open`, `handoff`, or `destroyed`. Route lifecycle changes through `transitionSession()` rather than adding mutable lifecycle flags.
- **Interaction state machine**: Anchor hover and popover hover state are kept separately in `HoverSessionInteractionState`. Route changes through `transitionSessionInteraction()`. The interaction reducer mutates the shared `HoverSessionInteractionState` in place (no object spread per event) to keep the hover/pointermove hot path allocation-free; this is the one intentional exception to the "pure reducers" rule below.
- **Side-effect boundary**: WeakMap patch ownership, listener teardown callbacks, timer handles, and Obsidian method calls remain imperative resources in `session.ts`. Reducers in `state-machine.ts` must stay pure.

## Invariants

- `transitionHoverSession`（lifecycle reducer）は純粋に保つこと。副作用（パッチ所有権・リスナーの teardown・タイマー・Obsidian 呼び出し）は `session.ts` に閉じ込めること。`transitionHoverSessionInteraction`（interaction reducer）は `HoverSessionInteractionState` を in-place で mutate して同一オブジェクトを返す演出上の例外（hover/pointermove の hot path allocation を削減するため）。2 つの固定 boolean フィールドのみで shape が安定するため HiddenClass 遷移は起きない。
- 状態遷移はすべて reducer (`transitionSession()` / `transitionSessionInteraction()`) 経由で行うこと。state machine と並行する mutable な lifecycle/interaction フラグ（active popover, active anchor, pending handoff, request sequence, destroyed 等）を再導入しないこと。
- 状態や遷移を追加・改名する場合は、`internal-types.ts` の判別ユニオンと reducer を正として更新し、このドキュメントの列挙も合わせること。
