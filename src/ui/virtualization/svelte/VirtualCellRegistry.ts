export interface VirtualCellMetadata {
	readonly logicalKey: string;
	readonly rowIndex?: number;
	readonly columnIndex?: number;
}

/**
 * Reuses one metadata object for a mounted cell element across logical updates.
 */
export interface VirtualCellElementRegistration {
	update(
		logicalKey: string,
		rowIndex: number | undefined,
		columnIndex: number | undefined,
	): void;
	unregister(): void;
}

interface MutableVirtualCellMetadata {
	logicalKey: string;
	rowIndex?: number;
	columnIndex?: number;
}

const metadataByElement = new WeakMap<HTMLElement, VirtualCellMetadata>();
const elementsByLogicalKey = new Map<string, Set<HTMLElement>>();

function removeElementFromLogicalKey(element: HTMLElement, logicalKey: string): void {
	const elements = elementsByLogicalKey.get(logicalKey);
	if (!elements) return;

	elements.delete(element);
	if (elements.size === 0) {
		elementsByLogicalKey.delete(logicalKey);
	}
}

function addElementForLogicalKey(element: HTMLElement, logicalKey: string): void {
	let elements = elementsByLogicalKey.get(logicalKey);
	if (!elements) {
		elements = new Set<HTMLElement>();
		elementsByLogicalKey.set(logicalKey, elements);
	}

	elements.add(element);
}

/**
 * Creates an updatable cell registration for pooled surfaces that reuse DOM
 * shells across logical cells.
 */
export function createVirtualCellElementRegistration(
	element: HTMLElement,
): VirtualCellElementRegistration {
	const metadata: MutableVirtualCellMetadata = {
		logicalKey: "",
	};
	let isRegistered = false;

	const unregister = (): void => {
		if (!isRegistered) {
			return;
		}

		if (metadataByElement.get(element) === metadata) {
			metadataByElement.delete(element);
			removeElementFromLogicalKey(element, metadata.logicalKey);
		}
		isRegistered = false;
	};

	const update = (
		logicalKey: string,
		rowIndex: number | undefined,
		columnIndex: number | undefined,
	): void => {
		if (
			isRegistered &&
			metadata.logicalKey === logicalKey &&
			metadata.rowIndex === rowIndex &&
			metadata.columnIndex === columnIndex
		) {
			return;
		}

		if (!isRegistered) {
			const previousMetadata = metadataByElement.get(element);
			if (previousMetadata) {
				removeElementFromLogicalKey(element, previousMetadata.logicalKey);
			}

			metadataByElement.set(element, metadata);
			addElementForLogicalKey(element, logicalKey);
			isRegistered = true;
		} else if (metadata.logicalKey !== logicalKey) {
			removeElementFromLogicalKey(element, metadata.logicalKey);
			addElementForLogicalKey(element, logicalKey);
		}

		metadata.logicalKey = logicalKey;
		metadata.rowIndex = rowIndex;
		metadata.columnIndex = columnIndex;
	};

	return {
		update,
		unregister,
	};
}

export function findRegisteredVirtualCellElementByKey(
	container: HTMLElement | null,
	key: string | null | undefined,
): HTMLElement | null {
	if (!container || !key) {
		return null;
	}

	for (const element of elementsByLogicalKey.get(key) ?? []) {
		if (container.contains(element)) {
			return element;
		}
	}

	return null;
}

export function findClosestRegisteredVirtualCell(
	target: HTMLElement | null,
): { element: HTMLElement; metadata: VirtualCellMetadata } | null {
	for (let element = target; element; element = element.parentElement) {
		const metadata = metadataByElement.get(element);
		if (metadata) {
			return { element, metadata };
		}
	}

	return null;
}
