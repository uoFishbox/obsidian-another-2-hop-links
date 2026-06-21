# AGENTS.md — Shadow DOM hover popovers

Hover popover implementation that bridges Shadow DOM anchors to Obsidian's light-DOM popover infrastructure.

- **Problem**: Obsidian's `hover-link` workspace event expects a light-DOM anchor element. Elements inside Shadow DOM are not directly usable as popover targets.
- **Solution**: A proxy-anchor system that bridges Shadow DOM anchors to Obsidian's hover popover infrastructure.

## Architecture

| Module                  | Purpose                                                                                  |
| ----------------------- | ---------------------------------------------------------------------------------------- |
| `controller.ts`         | Event delegation, lifecycle event dispatch, and side-effect orchestration.               |
| `launcher.ts`           | Triggers Obsidian's `hover-link` workspace event via a proxy `HoverParent`.              |
| `registry.ts`           | Maintains 1:1 mapping between Shadow DOM anchors and invisible light-DOM proxy elements. |
| `state-machine.ts`      | Pure lifecycle and interaction reducers plus state selectors.                            |
| `session.ts`            | Reducer adapters, popover patching, keep-alive logic, and side-effect resources.         |
| `internal-constants.ts` | Patch markers and symbol keys for popover monkey-patching.                               |
| `internal-types.ts`     | Duck-typed Obsidian interfaces and discriminated session state/event types.              |
| `public-types.ts`       | Public API types for the controller and link resolver.                                   |
| `dom-utils.ts`          | DOM helper utilities.                                                                    |
| `debug.ts`              | Debug logging and session/popover summarizers.                                           |

> この表はこのディレクトリのファイルと1:1です。ファイルを統合・分割・改名した場合は、同時にこの表も更新してください。

## Key mechanisms

- **Proxy anchors**: Each Shadow DOM anchor gets a hidden proxy `<div>` in `document.body`, positioned to match the actual anchor's screen coordinates. Obsidian's popover positions itself relative to this proxy.
- **Popover patching**: The popover's close/position/detect/transition methods are wrapped to consult the session's keep-alive state before allowing close.
- **Keep-alive logic**: Close is blocked while the mouse is over the anchor, over the popover, the popover is focused, or an element inside the popover has focus.
- **Handoff**: When moving to a new anchor, the old popover is kept alive briefly to allow smooth transitions.
- **Stale detection**: Each launch carries a monotonically increasing sequence number. Stale popover assignments are discarded.
- **Lifecycle state machine**: `HoverSessionState` is a discriminated union: `idle`, `hovering-anchor`, `opening`, `open`, `handoff`, `closing`, or `destroyed`. Route lifecycle changes through `transitionSession()` rather than adding mutable lifecycle flags.
- **Interaction state machine**: Anchor hover, popover hover, and recent outside interaction state are kept separately in `HoverSessionInteractionState`. Route changes through `transitionSessionInteraction()`.
- **Side-effect boundary**: WeakMap patch ownership, listener teardown callbacks, timer handles, and Obsidian method calls remain imperative resources in `session.ts`. Reducers in `state-machine.ts` must stay pure.

## Invariants

- `state-machine.ts` の reducer は純粋に保つこと。副作用（パッチ所有権・リスナーの teardown・タイマー・Obsidian 呼び出し）は `session.ts` に閉じ込めること。
- 状態遷移はすべて reducer (`transitionSession()` / `transitionSessionInteraction()`) 経由で行うこと。state machine と並行する mutable な lifecycle/interaction フラグ（active popover, active anchor, pending handoff, request sequence, destroyed 等）を再導入しないこと。
- 状態や遷移を追加・改名する場合は、`internal-types.ts` の判別ユニオンと reducer を正として更新し、このドキュメントの列挙も合わせること。
