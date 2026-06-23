export function hasSourceDependentRawLinkPath(rawLinkPath: string): boolean {
	let segmentStart = 0;
	for (let index = 0; index <= rawLinkPath.length; index++) {
		const ch = index < rawLinkPath.length ? rawLinkPath.charCodeAt(index) : -1;
		if (ch !== 0x2f /* / */ && ch !== 0x5c /* \ */ && ch !== -1) {
			continue;
		}

		const segmentLength = index - segmentStart;
		if (
			(segmentLength === 1 &&
				rawLinkPath.charCodeAt(segmentStart) === 0x2e) /* . */ ||
			(segmentLength === 2 &&
				rawLinkPath.charCodeAt(segmentStart) === 0x2e /* . */ &&
				rawLinkPath.charCodeAt(segmentStart + 1) === 0x2e) /* . */
		) {
			return true;
		}

		segmentStart = index + 1;
	}

	return false;
}
