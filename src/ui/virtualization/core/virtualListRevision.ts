import type { VirtualListRevision } from "../types";

function sameRevisionToken(current: unknown, next: unknown): boolean {
	if (Object.is(current, next)) {
		return true;
	}

	if (!Array.isArray(current) || !Array.isArray(next)) {
		return false;
	}

	if (current.length !== next.length) {
		return false;
	}

	for (let index = 0; index < current.length; index += 1) {
		if (!Object.is(current[index], next[index])) {
			return false;
		}
	}

	return true;
}

export function hasSameVirtualListRevision(
	current: VirtualListRevision,
	next: VirtualListRevision,
): boolean {
	return (
		sameRevisionToken(current.content, next.content) &&
		sameRevisionToken(current.layout, next.layout)
	);
}
