import { createContext } from "svelte";
import type { InteractionDescriptor, InteractionHandle } from "./interactionTypes";

export interface InteractionDescriptorResolverProvider {
	resolveInteractionDescriptor: (
		interactionHandle: InteractionHandle,
	) => InteractionDescriptor | null;
}

export interface InteractionRegistry {
	/** Registers one DOM binding and returns an idempotent disposer. */
	register: (
		interactionHandle: InteractionHandle,
		descriptor: InteractionDescriptor,
	) => () => void;
	setInteractionDescriptorResolverProvider: (
		provider: InteractionDescriptorResolverProvider | undefined,
	) => void;
	resolve: (
		interactionHandle: InteractionHandle,
	) => InteractionDescriptor | undefined;
	clear: () => void;
}

interface DirectDescriptorRegistration {
	readonly descriptor: InteractionDescriptor;
}

export function createInteractionRegistry(): InteractionRegistry {
	const directRegistrationsByHandle = new Map<
		InteractionHandle,
		DirectDescriptorRegistration[]
	>();
	let resolverProvider: InteractionDescriptorResolverProvider | undefined;

	return {
		register: (interactionHandle, descriptor) => {
			const registration: DirectDescriptorRegistration = { descriptor };
			const registrations = directRegistrationsByHandle.get(interactionHandle);
			if (registrations) registrations.push(registration);
			else directRegistrationsByHandle.set(interactionHandle, [registration]);

			let disposed = false;
			return () => {
				if (disposed) return;
				disposed = true;
				const currentRegistrations =
					directRegistrationsByHandle.get(interactionHandle);
				if (!currentRegistrations) return;
				const registrationIndex = currentRegistrations.indexOf(registration);
				if (registrationIndex < 0) return;
				currentRegistrations.splice(registrationIndex, 1);
				if (currentRegistrations.length === 0) {
					directRegistrationsByHandle.delete(interactionHandle);
				}
			};
		},
		setInteractionDescriptorResolverProvider: (provider) => {
			resolverProvider = provider;
		},
		resolve: (interactionHandle) => {
			const registrations = directRegistrationsByHandle.get(interactionHandle);
			const latestRegistration = registrations?.[registrations.length - 1];
			if (latestRegistration) return latestRegistration.descriptor;
			return (
				resolverProvider?.resolveInteractionDescriptor(interactionHandle) ??
				undefined
			);
		},
		clear: () => {
			directRegistrationsByHandle.clear();
			resolverProvider = undefined;
		},
	};
}

const [getInteractionRegistryContext, setInteractionRegistryContext] =
	createContext<InteractionRegistry>();

export { setInteractionRegistryContext };

export function useInteractionRegistry(): InteractionRegistry | undefined {
	try {
		return getInteractionRegistryContext();
	} catch {
		return undefined;
	}
}
