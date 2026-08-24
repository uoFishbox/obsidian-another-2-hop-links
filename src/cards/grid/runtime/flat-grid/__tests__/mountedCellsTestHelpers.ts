/** Asserts that one mounted snapshot never assigns a physical cell twice. */
export function expectUniquePhysicalCellSlots(
	cells: ReadonlyArray<{ physicalCellSlot: number }>,
): void {
	const physicalSlots = cells.map((cell) => cell.physicalCellSlot);
	expect(new Set(physicalSlots).size).toBe(physicalSlots.length);
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
