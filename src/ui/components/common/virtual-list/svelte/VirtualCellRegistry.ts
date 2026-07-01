export interface VirtualCellMetadata {
	readonly logicalKey: string;
	readonly rowIndex?: number;
	readonly columnIndex?: number;
}

const metadataByElement = new WeakMap<HTMLElement, VirtualCellMetadata>();
const elementsByLogicalKey = new Map<string, Set<HTMLElement>>();

function removeElementFromLogicalKey(
	element: HTMLElement,
	logicalKey: string,
): void {
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

export function registerVirtualCellElement(
	element: HTMLElement,
	metadata: VirtualCellMetadata,
): () => void {
	const previousMetadata = metadataByElement.get(element);
	if (previousMetadata) {
		removeElementFromLogicalKey(element, previousMetadata.logicalKey);
	}

	metadataByElement.set(element, metadata);
	addElementForLogicalKey(element, metadata.logicalKey);

	return () => {
		if (metadataByElement.get(element) !== metadata) {
			return;
		}

		metadataByElement.delete(element);
		removeElementFromLogicalKey(element, metadata.logicalKey);
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

export function getVirtualCellMetadata(
	element: HTMLElement | null,
): VirtualCellMetadata | null {
	if (!element) {
		return null;
	}

	return metadataByElement.get(element) ?? null;
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
