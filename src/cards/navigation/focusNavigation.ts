import { collectResultTargets } from "./resultTargets";
import type { VerticalNavigationDirection } from "./types";

export function focusResultEdge(
	container: HTMLElement | null,
	direction: VerticalNavigationDirection,
): HTMLElement | null {
	const targets = collectResultTargets(container);
	if (targets.length === 0) return null;
	const target = direction === "down" ? targets[0] : targets[targets.length - 1];
	target.focus({ preventScroll: true });
	target.scrollIntoView({ block: "nearest", inline: "nearest" });
	return target;
}
