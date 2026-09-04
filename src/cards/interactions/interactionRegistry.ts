import { createContext } from "svelte";
import type { InteractionDescriptor } from "./interactionTypes";

export type InteractionTokenPrefix = "i" | "h";

export interface InteractionDescriptorResolverProvider {
	resolveInteractionDescriptor: (
		interactionId: string,
	) => InteractionDescriptor | null;
}

export interface InteractionRegistry {
	createInteractionToken: (
		semanticKey: string,
		prefix?: InteractionTokenPrefix,
	) => string;
	/** Registers one owner and returns an idempotent disposer for that registration. */
	register: (descriptor: InteractionDescriptor) => () => void;
	syncInteractionDescriptorResolverProvider: (
		scopeId: string,
		provider: InteractionDescriptorResolverProvider | undefined,
	) => void;
	resolve: (interactionId: string) => InteractionDescriptor | undefined;
	clear: () => void;
}

interface DirectDescriptorRegistration {
	readonly descriptor: InteractionDescriptor;
}

export function createInteractionTokenAllocator(
	defaultPrefix: InteractionTokenPrefix = "i",
): (semanticKey: string, prefix?: InteractionTokenPrefix) => string {
	const tokenByKey = new Map<string, string>();
	const nextIdByPrefix = new Map<InteractionTokenPrefix, number>();

	return (semanticKey, prefix = defaultPrefix): string => {
		const scopedKey = `${prefix}\u0000${semanticKey}`;
		const existing = tokenByKey.get(scopedKey);
		if (existing) return existing;

		const nextId = nextIdByPrefix.get(prefix) ?? 0;
		const token = `${prefix}${nextId.toString(36)}`;
		nextIdByPrefix.set(prefix, nextId + 1);
		tokenByKey.set(scopedKey, token);
		return token;
	};
}

export function createInteractionRegistry(): InteractionRegistry {
	const createInteractionToken = createInteractionTokenAllocator();
	const directRegistrationsByInteractionId = new Map<
		string,
		DirectDescriptorRegistration[]
	>();
	const scopedResolverProviders = new Map<
		string,
		InteractionDescriptorResolverProvider
	>();

	const resolveScopedProviderDescriptor = (
		interactionId: string,
	): InteractionDescriptor | undefined => {
		for (const provider of scopedResolverProviders.values()) {
			const descriptor = provider.resolveInteractionDescriptor(interactionId);
			if (descriptor) return descriptor;
		}
		return undefined;
	};

	return {
		createInteractionToken,
		register: (descriptor) => {
			const interactionId = descriptor.interactionId;
			const registration: DirectDescriptorRegistration = { descriptor };
			const registrations = directRegistrationsByInteractionId.get(interactionId);
			if (registrations) registrations.push(registration);
			else directRegistrationsByInteractionId.set(interactionId, [registration]);

			let disposed = false;
			return () => {
				if (disposed) return;
				disposed = true;
				const currentRegistrations =
					directRegistrationsByInteractionId.get(interactionId);
				if (!currentRegistrations) return;
				const registrationIndex = currentRegistrations.indexOf(registration);
				if (registrationIndex < 0) return;
				currentRegistrations.splice(registrationIndex, 1);
				if (currentRegistrations.length === 0) {
					directRegistrationsByInteractionId.delete(interactionId);
				}
			};
		},
		syncInteractionDescriptorResolverProvider: (scopeId, provider) => {
			if (provider) {
				scopedResolverProviders.set(scopeId, provider);
			} else {
				scopedResolverProviders.delete(scopeId);
			}
		},
		resolve: (interactionId) => {
			const registrations = directRegistrationsByInteractionId.get(interactionId);
			const latestRegistration = registrations?.[registrations.length - 1];
			if (latestRegistration) return latestRegistration.descriptor;
			return resolveScopedProviderDescriptor(interactionId);
		},
		clear: () => {
			directRegistrationsByInteractionId.clear();
			scopedResolverProviders.clear();
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
