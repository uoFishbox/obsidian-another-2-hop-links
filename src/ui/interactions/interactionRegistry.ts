import { createContext } from "svelte";
import type { InteractionDescriptor } from "./interactionTypes";

export type InteractionTokenPrefix = "i" | "h";

export interface InteractionDescriptorResolver {
	interactionId: string;
	resolve: () => InteractionDescriptor | null;
}

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
	syncInteractionDescriptors: (
		scopeId: string,
		descriptors: readonly InteractionDescriptor[],
	) => void;
	syncInteractionDescriptorResolvers: (
		scopeId: string,
		resolvers: readonly InteractionDescriptorResolver[],
	) => void;
	syncInteractionDescriptorResolverProvider: (
		scopeId: string,
		provider: InteractionDescriptorResolverProvider | undefined,
	) => void;
	resolve: (interactionId: string) => InteractionDescriptor | undefined;
	clear: () => void;
}

export function createInteractionTokenAllocator(
	defaultPrefix: InteractionTokenPrefix = "i",
): (
	semanticKey: string,
	prefix?: InteractionTokenPrefix,
) => string {
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
	const descriptors = new Map<string, InteractionDescriptor>();
	const directDescriptors = new Map<string, InteractionDescriptor>();
	const scopedDescriptors = new Map<
		string,
		ReadonlyMap<string, InteractionDescriptor>
	>();
	const scopedResolvers = new Map<
		string,
		ReadonlyMap<string, InteractionDescriptorResolver>
	>();
	const scopedResolverProviders = new Map<
		string,
		InteractionDescriptorResolverProvider
	>();

	const resolveScopedDescriptor = (
		interactionId: string,
	): InteractionDescriptor | undefined => {
		for (const scopeDescriptors of scopedDescriptors.values()) {
			const descriptor = scopeDescriptors.get(interactionId);
			if (descriptor) return descriptor;
		}
		return undefined;
	};

	const resolveScopedResolver = (
		interactionId: string,
	): InteractionDescriptorResolver | undefined => {
		for (const scopeResolvers of scopedResolvers.values()) {
			const resolver = scopeResolvers.get(interactionId);
			if (resolver) return resolver;
		}
		return undefined;
	};

	const resolveScopedProviderDescriptor = (
		interactionId: string,
	): InteractionDescriptor | undefined => {
		for (const provider of scopedResolverProviders.values()) {
			const descriptor =
				provider.resolveInteractionDescriptor(interactionId);
			if (descriptor) return descriptor;
		}
		return undefined;
	};

	const refreshDescriptor = (interactionId: string): void => {
		const descriptor =
			directDescriptors.get(interactionId) ??
			resolveScopedDescriptor(interactionId);
		if (descriptor) {
			descriptors.set(interactionId, descriptor);
			return;
		}
		descriptors.delete(interactionId);
	};

	return {
		createInteractionToken,
		register: (descriptor) => {
			directDescriptors.set(descriptor.interactionId, descriptor);
			descriptors.set(descriptor.interactionId, descriptor);
		},
		unregister: (interactionId) => {
			directDescriptors.delete(interactionId);
			refreshDescriptor(interactionId);
		},
		syncInteractionDescriptors: (scopeId, nextDescriptors) => {
			const previousDescriptors = scopedDescriptors.get(scopeId);
			const nextDescriptorsById = new Map<
				string,
				InteractionDescriptor
			>();
			for (const descriptor of nextDescriptors) {
				nextDescriptorsById.set(descriptor.interactionId, descriptor);
			}
			if (nextDescriptorsById.size > 0) {
				scopedDescriptors.set(scopeId, nextDescriptorsById);
			} else {
				scopedDescriptors.delete(scopeId);
			}

			for (const interactionId of previousDescriptors?.keys() ?? []) {
				refreshDescriptor(interactionId);
			}
			for (const interactionId of nextDescriptorsById.keys()) {
				refreshDescriptor(interactionId);
			}
		},
		syncInteractionDescriptorResolvers: (scopeId, nextResolvers) => {
			const previousResolvers = scopedResolvers.get(scopeId);
			scopedResolverProviders.delete(scopeId);
			const nextResolversById = new Map<
				string,
				InteractionDescriptorResolver
			>();
			for (const resolver of nextResolvers) {
				nextResolversById.set(resolver.interactionId, resolver);
			}
			if (nextResolversById.size > 0) {
				scopedResolvers.set(scopeId, nextResolversById);
			} else {
				scopedResolvers.delete(scopeId);
			}

			for (const interactionId of previousResolvers?.keys() ?? []) {
				if (!nextResolversById.has(interactionId)) {
					refreshDescriptor(interactionId);
				}
			}
			for (const [interactionId, resolver] of nextResolversById) {
				if (previousResolvers?.get(interactionId) !== resolver) {
					refreshDescriptor(interactionId);
				}
			}
		},
		syncInteractionDescriptorResolverProvider: (scopeId, provider) => {
			const previousResolvers = scopedResolvers.get(scopeId);
			scopedResolvers.delete(scopeId);
			if (provider) {
				scopedResolverProviders.set(scopeId, provider);
			} else {
				scopedResolverProviders.delete(scopeId);
			}

			for (const interactionId of previousResolvers?.keys() ?? []) {
				refreshDescriptor(interactionId);
			}
		},
		resolve: (interactionId) => {
			const descriptor = descriptors.get(interactionId);
			if (descriptor) return descriptor;

			const resolvedDescriptor =
				resolveScopedResolver(interactionId)?.resolve() ?? undefined;
			if (resolvedDescriptor) {
				descriptors.set(interactionId, resolvedDescriptor);
				return resolvedDescriptor;
			}

			return resolveScopedProviderDescriptor(interactionId);
		},
		clear: () => {
			descriptors.clear();
			directDescriptors.clear();
			scopedDescriptors.clear();
			scopedResolvers.clear();
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
