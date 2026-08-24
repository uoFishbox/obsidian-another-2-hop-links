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
	register: (descriptor: InteractionDescriptor) => void;
	unregister: (interactionId: string) => void;
	syncInteractionDescriptorResolverProvider: (
		scopeId: string,
		provider: InteractionDescriptorResolverProvider | undefined,
	) => void;
	resolve: (interactionId: string) => InteractionDescriptor | undefined;
	clear: () => void;
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
	const directDescriptors = new Map<string, InteractionDescriptor>();
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
			directDescriptors.set(descriptor.interactionId, descriptor);
		},
		unregister: (interactionId) => {
			directDescriptors.delete(interactionId);
		},
		syncInteractionDescriptorResolverProvider: (scopeId, provider) => {
			if (provider) {
				scopedResolverProviders.set(scopeId, provider);
			} else {
				scopedResolverProviders.delete(scopeId);
			}
		},
		resolve: (interactionId) => {
			const descriptor = directDescriptors.get(interactionId);
			if (descriptor) return descriptor;
			return resolveScopedProviderDescriptor(interactionId);
		},
		clear: () => {
			directDescriptors.clear();
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
