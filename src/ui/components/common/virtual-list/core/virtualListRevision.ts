import type { VirtualListRevision } from "../types";

export type VirtualListRevisionKey = keyof VirtualListRevision;

export type VirtualListRevisionDependency = Partial<
	Record<VirtualListRevisionKey, true>
>;

export type VirtualListRevisionDependencySnapshot = {
	-readonly [K in keyof VirtualListRevision]?: VirtualListRevision[K];
};

export const VIRTUAL_LIST_CONTENT_LAYOUT_DEPENDENCY = {
	content: true,
	layout: true,
} as const satisfies VirtualListRevisionDependency;

export const VIRTUAL_LIST_CONTENT_LAYOUT_KEY_DEPENDENCY = {
	content: true,
	layout: true,
	keyResolver: true,
} as const satisfies VirtualListRevisionDependency;

export const VIRTUAL_LIST_CONTENT_LAYOUT_PAGINATION_DEPENDENCY = {
	content: true,
	layout: true,
	pagination: true,
} as const satisfies VirtualListRevisionDependency;

const EMPTY_TOKEN = Symbol("virtual-list-empty-revision-token");
const VIRTUAL_LIST_LAYOUT_REVISION_TOKEN = Symbol("virtual-list-layout-revision-token");

export interface VirtualListLayoutRevisionToken {
	readonly kind: typeof VIRTUAL_LIST_LAYOUT_REVISION_TOKEN;
	readonly values: readonly unknown[];
}

export function createVirtualListLayoutRevisionToken(
	values: readonly unknown[],
): VirtualListLayoutRevisionToken {
	return {
		kind: VIRTUAL_LIST_LAYOUT_REVISION_TOKEN,
		values: Object.freeze([...values]),
	};
}

export function createVirtualListRevision(
	revision: Partial<VirtualListRevision> = {},
): VirtualListRevision {
	return {
		content: revision.content ?? EMPTY_TOKEN,
		layout: revision.layout ?? EMPTY_TOKEN,
		keyResolver: revision.keyResolver ?? EMPTY_TOKEN,
		pagination: revision.pagination ?? EMPTY_TOKEN,
		measurement: revision.measurement ?? EMPTY_TOKEN,
		previewPolicy: revision.previewPolicy ?? EMPTY_TOKEN,
	};
}

export function sameRevisionToken(current: unknown, next: unknown): boolean {
	if (Object.is(current, next)) {
		return true;
	}

	if (!Array.isArray(current) || !Array.isArray(next)) {
		return false;
	}

	if (current.length !== next.length) {
		return false;
	}

	for (let index = 0; index < current.length; index += 1) {
		if (!Object.is(current[index], next[index])) {
			return false;
		}
	}

	return true;
}

function isVirtualListLayoutRevisionToken(
	value: unknown,
): value is VirtualListLayoutRevisionToken {
	return (
		typeof value === "object" &&
		value !== null &&
		(value as VirtualListLayoutRevisionToken).kind ===
			VIRTUAL_LIST_LAYOUT_REVISION_TOKEN &&
		Array.isArray((value as VirtualListLayoutRevisionToken).values)
	);
}

function hasSameRevisionValue(current: unknown, next: unknown): boolean {
	if (sameRevisionToken(current, next)) {
		return true;
	}

	if (
		isVirtualListLayoutRevisionToken(current) &&
		isVirtualListLayoutRevisionToken(next)
	) {
		if (current.values.length !== next.values.length) {
			return false;
		}

		for (let index = 0; index < current.values.length; index += 1) {
			if (!Object.is(current.values[index], next.values[index])) {
				return false;
			}
		}
		return true;
	}

	return false;
}

export function hasSameVirtualListRevisionDependency(
	current: VirtualListRevision,
	next: VirtualListRevision,
	dependency: VirtualListRevisionDependency,
): boolean {
	if (
		"content" in dependency &&
		!hasSameRevisionValue(current.content, next.content)
	) {
		return false;
	}
	if ("layout" in dependency && !hasSameRevisionValue(current.layout, next.layout)) {
		return false;
	}
	if (
		"keyResolver" in dependency &&
		!hasSameRevisionValue(current.keyResolver, next.keyResolver)
	) {
		return false;
	}
	if (
		"pagination" in dependency &&
		!hasSameRevisionValue(current.pagination, next.pagination)
	) {
		return false;
	}
	if (
		"measurement" in dependency &&
		!hasSameRevisionValue(current.measurement, next.measurement)
	) {
		return false;
	}
	if (
		"previewPolicy" in dependency &&
		!hasSameRevisionValue(current.previewPolicy, next.previewPolicy)
	) {
		return false;
	}

	return true;
}

export function pickVirtualListRevisionDependency(
	revision: VirtualListRevision,
	dependency: VirtualListRevisionDependency,
): VirtualListRevisionDependencySnapshot {
	const picked: VirtualListRevisionDependencySnapshot = {};

	if ("content" in dependency) {
		picked.content = revision.content;
	}
	if ("layout" in dependency) {
		picked.layout = revision.layout;
	}
	if ("keyResolver" in dependency) {
		picked.keyResolver = revision.keyResolver;
	}
	if ("pagination" in dependency) {
		picked.pagination = revision.pagination;
	}
	if ("measurement" in dependency) {
		picked.measurement = revision.measurement;
	}
	if ("previewPolicy" in dependency) {
		picked.previewPolicy = revision.previewPolicy;
	}

	return picked;
}
