export function shouldAssertVirtualListInvariants(): boolean {
	return (
		typeof process !== "undefined" && process.env?.NODE_ENV !== "production"
	);
}

export function assertVirtualListInvariant(
	condition: boolean,
	message: string,
): asserts condition {
	if (!condition) {
		throw new Error(message);
	}
}
