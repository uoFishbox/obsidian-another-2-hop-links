export function expectUniqueRenderSlots(
	cells: ReadonlyArray<{ renderSlotIndex: number }>,
): void {
	const keys = cells.map((c) => c.renderSlotIndex);
	expect(new Set(keys).size).toBe(keys.length);
}

export function expectKeys(cells: ReadonlyArray<{ key: string }>): {
	toEqual(expected: string[]): void;
} {
	return {
		toEqual(expected: string[]) {
			expect(cells.map((c) => c.key)).toEqual(expected);
		},
	};
}
