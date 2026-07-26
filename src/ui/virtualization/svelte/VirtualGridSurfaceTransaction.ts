import type { InteractionDescriptor } from "ui/interactions/interactionTypes";
import { dispatchVirtualCellWillRebind } from "ui/interactions/virtualCellRebind";
import type { Action } from "svelte/action";
import {
	createVirtualCellElementRegistration,
	type VirtualCellElementRegistration,
	type VirtualCellRegistrationOwner,
	type VirtualCellRegistry,
} from "./VirtualCellRegistry";

export interface VirtualGridCellLifecycle {
	attach(): void;
	detach(): void;
}

export interface VirtualGridCellRebind {
	element: HTMLElement;
	previousLogicalKey?: string;
	nextLogicalKey: string;
	rowIndex?: number;
	columnIndex?: number;
	interactionDescriptor?: InteractionDescriptor | null;
	lifecycle?: VirtualGridCellLifecycle;
	cellRegistry?: VirtualCellRegistry;
	cellRegistrationOwner?: VirtualCellRegistrationOwner;
}

export interface VirtualGridSurfaceTransaction {
	rebindCell(rebind: VirtualGridCellRebind): void;
	releaseCell(element: HTMLElement): void;
}

export interface VirtualGridSurfaceTransactionOptions {
	onLogicalCellWillRebind?: (rebind: VirtualGridCellRebind) => void;
}

export interface VirtualGridCellActionParams {
	transaction: VirtualGridSurfaceTransaction;
	rebind: Omit<VirtualGridCellRebind, "element">;
}

interface DirectRegistrationBinding {
	readonly type: "direct";
	readonly registry: VirtualCellRegistry | undefined;
	readonly registration: VirtualCellElementRegistration;
}

interface OwnedRegistrationBinding {
	readonly type: "owned";
	readonly registry: VirtualCellRegistry;
	readonly owner: VirtualCellRegistrationOwner;
}

type RegistrationBinding = DirectRegistrationBinding | OwnedRegistrationBinding;

interface CellBinding {
	logicalKey: string;
	rowIndex?: number;
	columnIndex?: number;
	interactionDescriptor?: InteractionDescriptor | null;
	lifecycle?: VirtualGridCellLifecycle;
	registration: RegistrationBinding;
}

/**
 * Owns the imperative state changes required when a physical grid cell is
 * rebound to another logical cell.
 */
export function createVirtualGridSurfaceTransaction(
	options: VirtualGridSurfaceTransactionOptions = {},
): VirtualGridSurfaceTransaction {
	const bindingByElement = new WeakMap<HTMLElement, CellBinding>();

	const releaseRegistration = (
		element: HTMLElement,
		registration: RegistrationBinding,
	): void => {
		if (registration.type === "owned") {
			registration.owner.detachElement(element);
			return;
		}
		registration.registration.unregister();
	};

	const createRegistration = (
		element: HTMLElement,
		rebind: VirtualGridCellRebind,
	): RegistrationBinding => {
		if (rebind.cellRegistrationOwner && rebind.cellRegistry) {
			rebind.cellRegistrationOwner.attachElement(element, rebind.cellRegistry);
			return {
				type: "owned",
				registry: rebind.cellRegistry,
				owner: rebind.cellRegistrationOwner,
			};
		}

		const registration = rebind.cellRegistry
			? rebind.cellRegistry.createRegistration(element)
			: createVirtualCellElementRegistration(element);
		return {
			type: "direct",
			registry: rebind.cellRegistry,
			registration,
		};
	};

	const matchesRegistrationOwner = (
		registration: RegistrationBinding,
		rebind: VirtualGridCellRebind,
	): boolean => {
		if (registration.type === "owned") {
			return (
				registration.owner === rebind.cellRegistrationOwner &&
				registration.registry === rebind.cellRegistry
			);
		}
		return (
			(rebind.cellRegistrationOwner === undefined ||
				rebind.cellRegistry === undefined) &&
			registration.registry === rebind.cellRegistry
		);
	};

	const updateRegistration = (
		element: HTMLElement,
		previous: CellBinding | undefined,
		rebind: VirtualGridCellRebind,
	): RegistrationBinding => {
		let registration = previous?.registration;
		if (registration && !matchesRegistrationOwner(registration, rebind)) {
			releaseRegistration(element, registration);
			registration = undefined;
		}
		registration ??= createRegistration(element, rebind);

		if (
			registration.type === "direct" &&
			(!previous ||
				previous.logicalKey !== rebind.nextLogicalKey ||
				previous.rowIndex !== rebind.rowIndex ||
				previous.columnIndex !== rebind.columnIndex ||
				previous.registration !== registration)
		) {
			registration.registration.update(
				rebind.nextLogicalKey,
				rebind.rowIndex,
				rebind.columnIndex,
			);
		}

		return registration;
	};

	const rebindCell = (rebind: VirtualGridCellRebind): void => {
		const previous = bindingByElement.get(rebind.element);
		const previousLogicalKey = previous?.logicalKey ?? rebind.previousLogicalKey;
		const logicalKeyChanged =
			previousLogicalKey !== undefined &&
			previousLogicalKey !== rebind.nextLogicalKey;

		if (logicalKeyChanged) {
			options.onLogicalCellWillRebind?.({
				...rebind,
				previousLogicalKey,
			});
			dispatchVirtualCellWillRebind(rebind.element, {
				previousLogicalKey,
				nextLogicalKey: rebind.nextLogicalKey,
			});
			previous?.lifecycle?.detach();
		}

		const registration = updateRegistration(rebind.element, previous, rebind);

		if (!previous || logicalKeyChanged) {
			rebind.lifecycle?.attach();
		}

		bindingByElement.set(rebind.element, {
			logicalKey: rebind.nextLogicalKey,
			rowIndex: rebind.rowIndex,
			columnIndex: rebind.columnIndex,
			interactionDescriptor: rebind.interactionDescriptor,
			lifecycle: rebind.lifecycle,
			registration,
		});
	};

	const releaseCell = (element: HTMLElement): void => {
		const binding = bindingByElement.get(element);
		if (!binding) return;

		binding.lifecycle?.detach();
		releaseRegistration(element, binding.registration);
		bindingByElement.delete(element);
	};

	return {
		rebindCell,
		releaseCell,
	};
}

/** Connects one physical cell element to its surface-owned transaction. */
export const bindVirtualGridCell: Action<
	HTMLElement,
	VirtualGridCellActionParams | undefined
> = (element, initial) => {
	let transaction = initial?.transaction;
	if (initial) {
		initial.transaction.rebindCell({ element, ...initial.rebind });
	}

	return {
		update(next): void {
			if (!next) {
				transaction?.releaseCell(element);
				transaction = undefined;
				return;
			}
			if (transaction !== next.transaction) {
				transaction?.releaseCell(element);
				transaction = next.transaction;
			}
			next.transaction.rebindCell({ element, ...next.rebind });
		},
		destroy(): void {
			transaction?.releaseCell(element);
		},
	};
};
