import type { InteractionDescriptor } from "ui/interactions/interactionTypes";
import { dispatchVirtualCellWillRebind } from "ui/interactions/virtualCellRebind";
import type { ActionReturn } from "svelte/action";
import {
	createVirtualCellElementRegistration,
	type VirtualCellElementRegistration,
	type VirtualCellRegistrationOwner,
	type VirtualCellRegistry,
} from "./VirtualCellRegistry";

export interface VirtualGridCellRebindMetadata {
	previousLogicalKey?: string;
	nextLogicalKey: string;
	rowIndex?: number;
	columnIndex?: number;
	interactionDescriptor?: InteractionDescriptor | null;
	cellRegistry?: VirtualCellRegistry;
	cellRegistrationOwner?: VirtualCellRegistrationOwner;
}

export interface VirtualGridCellRebind<
	TLifecycleValue = undefined,
> extends VirtualGridCellRebindMetadata {
	lifecycleValue?: TLifecycleValue;
	onAttach?: (value: TLifecycleValue) => void;
	onDetach?: (value: TLifecycleValue) => void;
}

export interface VirtualGridSurfaceTransaction {
	rebindCell<TLifecycleValue>(
		element: HTMLElement,
		rebind: VirtualGridCellRebind<TLifecycleValue>,
	): void;
	releaseCell(element: HTMLElement): void;
}

export interface VirtualGridSurfaceTransactionOptions {
	onLogicalCellWillRebind?: (
		element: HTMLElement,
		previousLogicalKey: string,
		rebind: VirtualGridCellRebindMetadata,
	) => void;
}

export interface VirtualGridCellActionParams<
	TLifecycleValue = undefined,
> extends VirtualGridCellRebind<TLifecycleValue> {
	transaction: VirtualGridSurfaceTransaction;
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
	lifecycleValue?: unknown;
	onAttach?: (value: never) => void;
	onDetach?: (value: never) => void;
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
		rebind: VirtualGridCellRebindMetadata,
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
		rebind: VirtualGridCellRebindMetadata,
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
		rebind: VirtualGridCellRebindMetadata,
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

	const rebindCell = <TLifecycleValue>(
		element: HTMLElement,
		rebind: VirtualGridCellRebind<TLifecycleValue>,
	): void => {
		const previous = bindingByElement.get(element);
		if (
			previous &&
			previous.logicalKey === rebind.nextLogicalKey &&
			previous.rowIndex === rebind.rowIndex &&
			previous.columnIndex === rebind.columnIndex &&
			previous.interactionDescriptor === rebind.interactionDescriptor &&
			previous.lifecycleValue === rebind.lifecycleValue &&
			previous.onAttach === rebind.onAttach &&
			previous.onDetach === rebind.onDetach &&
			matchesRegistrationOwner(previous.registration, rebind)
		) {
			return;
		}

		const previousLogicalKey = previous?.logicalKey ?? rebind.previousLogicalKey;
		const logicalKeyChanged =
			previousLogicalKey !== undefined &&
			previousLogicalKey !== rebind.nextLogicalKey;

		if (logicalKeyChanged) {
			options.onLogicalCellWillRebind?.(element, previousLogicalKey, rebind);
			dispatchVirtualCellWillRebind(element, {
				previousLogicalKey,
				nextLogicalKey: rebind.nextLogicalKey,
			});
			previous?.onDetach?.(previous.lifecycleValue as never);
		}

		const registration = updateRegistration(element, previous, rebind);

		if (!previous || logicalKeyChanged) {
			rebind.onAttach?.(rebind.lifecycleValue as TLifecycleValue);
		}

		if (previous) {
			previous.logicalKey = rebind.nextLogicalKey;
			previous.rowIndex = rebind.rowIndex;
			previous.columnIndex = rebind.columnIndex;
			previous.interactionDescriptor = rebind.interactionDescriptor;
			previous.lifecycleValue = rebind.lifecycleValue;
			previous.onAttach = rebind.onAttach;
			previous.onDetach = rebind.onDetach;
			previous.registration = registration;
			return;
		}

		bindingByElement.set(element, {
			logicalKey: rebind.nextLogicalKey,
			rowIndex: rebind.rowIndex,
			columnIndex: rebind.columnIndex,
			interactionDescriptor: rebind.interactionDescriptor,
			lifecycleValue: rebind.lifecycleValue,
			onAttach: rebind.onAttach,
			onDetach: rebind.onDetach,
			registration,
		});
	};

	const releaseCell = (element: HTMLElement): void => {
		const binding = bindingByElement.get(element);
		if (!binding) return;

		binding.onDetach?.(binding.lifecycleValue as never);
		releaseRegistration(element, binding.registration);
		bindingByElement.delete(element);
	};

	return {
		rebindCell,
		releaseCell,
	};
}

/** Connects one physical cell element to its surface-owned transaction. */
export function bindVirtualGridCell<TLifecycleValue>(
	element: HTMLElement,
	initial: VirtualGridCellActionParams<TLifecycleValue> | undefined,
): ActionReturn<VirtualGridCellActionParams<TLifecycleValue> | undefined> {
	let transaction = initial?.transaction;
	if (initial) {
		initial.transaction.rebindCell(element, initial);
	}

	return {
		update(next: VirtualGridCellActionParams<TLifecycleValue> | undefined): void {
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
