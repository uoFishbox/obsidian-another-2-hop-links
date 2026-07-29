export interface DedupState {
	readonly usedKeys: ReadonlySet<string>;
}

export interface DedupResult<T> {
	readonly state: DedupState;
	readonly items: readonly T[];
}
