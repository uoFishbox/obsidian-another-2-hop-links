export function sameArrayBy<T>(
	current: readonly T[],
	next: readonly T[],
	equals: (current: T, next: T) => boolean,
): boolean {
	if (current === next) {
		return true;
	}

	if (current.length !== next.length) {
		return false;
	}

	for (let index = 0; index < current.length; index += 1) {
		if (!equals(current[index], next[index])) {
			return false;
		}
	}

	return true;
}

export function samePrimitiveArray<T extends string | number | boolean>(
	current: readonly T[],
	next: readonly T[],
): boolean {
	if (current === next) {
		return true;
	}

	if (current.length !== next.length) {
		return false;
	}

	for (let index = 0; index < current.length; index += 1) {
		if (current[index] !== next[index]) {
			return false;
		}
	}

	return true;
}
