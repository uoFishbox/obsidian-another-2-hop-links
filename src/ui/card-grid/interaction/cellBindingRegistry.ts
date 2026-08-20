import { dispatchVirtualCellWillRebind } from "ui/interactions/virtualCellRebind";
import type { ActionReturn } from "svelte/action";

export interface VirtualGridCellRebindMetadata {
	previousLogicalKey?: string;
	nextLogicalKey: string;
	rowIndex?: number;
	columnIndex?: number;
}

export interface VirtualGridCellMetadata {
	readonly logicalKey: string;
	readonly rowIndex?: number;
	readonly columnIndex?: number;
}

/** Tracks the logical cell currently assigned to each physical grid cell. */
export interface VirtualCellBindingRegistry {
	rebindCell(element: HTMLElement, rebind: VirtualGridCellRebindMetadata): void;
	releaseCell(element: HTMLElement): void;
	findCellElementByKey(
		container: HTMLElement | null,
		key: string | null | undefined,
	): HTMLElement | null;
	findClosestCell(
		target: HTMLElement | null,
	): { element: HTMLElement; metadata: VirtualGridCellMetadata } | null;
}

export interface VirtualCellBindingRegistryOptions {
	onLogicalCellWillRebind?: (
		element: HTMLElement,
		previousLogicalKey: string,
		rebind: VirtualGridCellRebindMetadata,
	) => void;
}

export interface VirtualCellBindingActionParams extends VirtualGridCellRebindMetadata {
	registry: VirtualCellBindingRegistry;
}

interface MutableVirtualGridCellMetadata {
	logicalKey: string;
	rowIndex?: number;
	columnIndex?: number;
}

/**
 * Owns physical-to-logical cell bindings and navigation lookups for one
 * rendered surface. Keeping both indexes here avoids duplicating binding state
 * in a process-wide registry.
 */
export function createVirtualCellBindingRegistry(
	options: VirtualCellBindingRegistryOptions = {},
): VirtualCellBindingRegistry {
	const metadataByElement = new WeakMap<
		HTMLElement,
		MutableVirtualGridCellMetadata
	>();
	const elementsByLogicalKey = new Map<string, Set<HTMLElement>>();

	const removeElementFromLogicalKey = (
		element: HTMLElement,
		logicalKey: string,
	): void => {
		const elements = elementsByLogicalKey.get(logicalKey);
		if (!elements) return;

		elements.delete(element);
		if (elements.size === 0) {
			elementsByLogicalKey.delete(logicalKey);
		}
	};

	const addElementForLogicalKey = (
		element: HTMLElement,
		logicalKey: string,
	): void => {
		let elements = elementsByLogicalKey.get(logicalKey);
		if (!elements) {
			elements = new Set<HTMLElement>();
			elementsByLogicalKey.set(logicalKey, elements);
		}
		elements.add(element);
	};

	const rebindCell = (
		element: HTMLElement,
		rebind: VirtualGridCellRebindMetadata,
	): void => {
		const metadata = metadataByElement.get(element);
		if (
			metadata?.logicalKey === rebind.nextLogicalKey &&
			metadata.rowIndex === rebind.rowIndex &&
			metadata.columnIndex === rebind.columnIndex
		) {
			return;
		}

		const previousLogicalKey = metadata?.logicalKey ?? rebind.previousLogicalKey;
		if (
			previousLogicalKey !== undefined &&
			previousLogicalKey !== rebind.nextLogicalKey
		) {
			options.onLogicalCellWillRebind?.(element, previousLogicalKey, rebind);
			dispatchVirtualCellWillRebind(element, {
				previousLogicalKey,
				nextLogicalKey: rebind.nextLogicalKey,
			});
		}

		if (!metadata) {
			const nextMetadata: MutableVirtualGridCellMetadata = {
				logicalKey: rebind.nextLogicalKey,
				rowIndex: rebind.rowIndex,
				columnIndex: rebind.columnIndex,
			};
			metadataByElement.set(element, nextMetadata);
			addElementForLogicalKey(element, rebind.nextLogicalKey);
			return;
		}

		if (metadata.logicalKey !== rebind.nextLogicalKey) {
			removeElementFromLogicalKey(element, metadata.logicalKey);
			addElementForLogicalKey(element, rebind.nextLogicalKey);
		}
		metadata.logicalKey = rebind.nextLogicalKey;
		metadata.rowIndex = rebind.rowIndex;
		metadata.columnIndex = rebind.columnIndex;
	};

	const releaseCell = (element: HTMLElement): void => {
		const metadata = metadataByElement.get(element);
		if (!metadata) return;

		removeElementFromLogicalKey(element, metadata.logicalKey);
		metadataByElement.delete(element);
	};

	return {
		rebindCell,
		releaseCell,
		findCellElementByKey(container, key): HTMLElement | null {
			if (!container || !key) return null;
			for (const element of elementsByLogicalKey.get(key) ?? []) {
				if (container.contains(element)) return element;
			}
			return null;
		},
		findClosestCell(target) {
			for (let element = target; element; element = element.parentElement) {
				const metadata = metadataByElement.get(element);
				if (metadata) {
					return { element, metadata };
				}
			}
			return null;
		},
	};
}

/** Connects one physical cell element to its surface-owned transaction. */
export function bindVirtualCell(
	element: HTMLElement,
	initial: VirtualCellBindingActionParams | undefined,
): ActionReturn<VirtualCellBindingActionParams | undefined> {
	let registry = initial?.registry;
	if (initial) {
		initial.registry.rebindCell(element, initial);
	}

	return {
		update(next: VirtualCellBindingActionParams | undefined): void {
			if (!next) {
				registry?.releaseCell(element);
				registry = undefined;
				return;
			}
			if (registry !== next.registry) {
				registry?.releaseCell(element);
				registry = next.registry;
			}
			next.registry.rebindCell(element, next);
		},
		destroy(): void {
			registry?.releaseCell(element);
		},
	};
}
