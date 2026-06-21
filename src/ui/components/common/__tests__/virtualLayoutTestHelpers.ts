export function expectUniqueRenderSlots(
	cells: ReadonlyArray<{ renderSlotKey: number }>,
): void {
	const keys = cells.map((c) => c.renderSlotKey);
	expect(new Set(keys).size).toBe(keys.length);
}

export function expectKeys(
	cells: ReadonlyArray<{ key: string }>,
): { toEqual(expected: string[]): void } {
	return {
		toEqual(expected: string[]) {
			expect(cells.map((c) => c.key)).toEqual(expected);
		},
	};
}

export function expectReusedForKeys<T extends { key: string }>(
	next: { cells: ReadonlyArray<T> },
	prev: { cells: ReadonlyArray<T> },
	keys: string[],
): void {
	const prevByKey = new Map(prev.cells.map((c) => [c.key, c]));
	for (const key of keys) {
		const nextCell = next.cells.find((c) => c.key === key);
		expect(nextCell).toBe(prevByKey.get(key));
	}
}

export function expectRecreatedForKeys<T extends { key: string }>(
	next: { cells: ReadonlyArray<T> },
	prev: { cells: ReadonlyArray<T> },
	keys: string[],
): void {
	const prevByKey = new Map(prev.cells.map((c) => [c.key, c]));
	for (const key of keys) {
		const nextCell = next.cells.find((c) => c.key === key);
		expect(nextCell).not.toBe(prevByKey.get(key));
	}
}
