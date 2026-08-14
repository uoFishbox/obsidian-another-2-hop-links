import { dispatchVirtualCellWillRebind } from "ui/interactions/virtualCellRebind";
import type { ActionReturn } from "svelte/action";
import {
	createVirtualCellElementRegistration,
	type VirtualCellElementRegistration,
} from "./VirtualCellRegistry";

export interface VirtualGridCellRebindMetadata {
	previousLogicalKey?: string;
	nextLogicalKey: string;
	rowIndex?: number;
	columnIndex?: number;
}

export interface VirtualGridSurfaceTransaction {
	rebindCell(element: HTMLElement, rebind: VirtualGridCellRebindMetadata): void;
	releaseCell(element: HTMLElement): void;
}

export interface VirtualGridSurfaceTransactionOptions {
	onLogicalCellWillRebind?: (
		element: HTMLElement,
		previousLogicalKey: string,
		rebind: VirtualGridCellRebindMetadata,
	) => void;
}

export interface VirtualGridCellActionParams extends VirtualGridCellRebindMetadata {
	transaction: VirtualGridSurfaceTransaction;
}

interface CellBinding {
	logicalKey: string;
	rowIndex?: number;
	columnIndex?: number;
	readonly registration: VirtualCellElementRegistration;
}

/**
 * Owns the imperative state changes required when a physical grid cell is
 * rebound to another logical cell.
 */
export function createVirtualGridSurfaceTransaction(
	options: VirtualGridSurfaceTransactionOptions = {},
): VirtualGridSurfaceTransaction {
	const bindingByElement = new WeakMap<HTMLElement, CellBinding>();

	const rebindCell = (
		element: HTMLElement,
		rebind: VirtualGridCellRebindMetadata,
	): void => {
		const previous = bindingByElement.get(element);
		if (
			previous?.logicalKey === rebind.nextLogicalKey &&
			previous.rowIndex === rebind.rowIndex &&
			previous.columnIndex === rebind.columnIndex
		) {
			return;
		}

		const previousLogicalKey = previous?.logicalKey ?? rebind.previousLogicalKey;
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

		const registration =
			previous?.registration ?? createVirtualCellElementRegistration(element);
		registration.update(rebind.nextLogicalKey, rebind.rowIndex, rebind.columnIndex);

		if (previous) {
			previous.logicalKey = rebind.nextLogicalKey;
			previous.rowIndex = rebind.rowIndex;
			previous.columnIndex = rebind.columnIndex;
			return;
		}

		bindingByElement.set(element, {
			logicalKey: rebind.nextLogicalKey,
			rowIndex: rebind.rowIndex,
			columnIndex: rebind.columnIndex,
			registration,
		});
	};

	const releaseCell = (element: HTMLElement): void => {
		const binding = bindingByElement.get(element);
		if (!binding) return;

		binding.registration.unregister();
		bindingByElement.delete(element);
	};

	return {
		rebindCell,
		releaseCell,
	};
}

/** Connects one physical cell element to its surface-owned transaction. */
export function bindVirtualGridCell(
	element: HTMLElement,
	initial: VirtualGridCellActionParams | undefined,
): ActionReturn<VirtualGridCellActionParams | undefined> {
	let transaction = initial?.transaction;
	if (initial) {
		initial.transaction.rebindCell(element, initial);
	}

	return {
		update(next: VirtualGridCellActionParams | undefined): void {
			if (!next) {
				transaction?.releaseCell(element);
				transaction = undefined;
				return;
			}
			if (transaction !== next.transaction) {
				transaction?.releaseCell(element);
				transaction = next.transaction;
			}
			next.transaction.rebindCell(element, next);
		},
		destroy(): void {
			transaction?.releaseCell(element);
		},
	};
}
