import type { DedupState } from "types/deduplication";

export interface UsageTracker {
	tryMarkUsed(key: string): boolean;
	getState(): DedupState;
}

export function createDedupState(): DedupState {
	return { usedKeys: new Set<string>() };
}

export function createUsageTracker(state: DedupState): UsageTracker {
	let usedKeys: Set<string> | undefined;

	function tryMarkUsed(key: string): boolean {
		const currentUsedKeys = usedKeys ?? state.usedKeys;
		if (currentUsedKeys.has(key)) return false;

		usedKeys ??= new Set(state.usedKeys);
		usedKeys.add(key);
		return true;
	}

	function getState(): DedupState {
		return usedKeys ? { usedKeys } : state;
	}

	return { tryMarkUsed, getState };
}
