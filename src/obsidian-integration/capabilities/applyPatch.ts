import type { Plugin } from "obsidian";
import { around } from "monkey-around";

type AnyFn = (...args: any[]) => any;

type MethodKeys<T> = {
	[K in keyof T]: T[K] extends (...args: never[]) => unknown ? K : never;
}[keyof T];

export type PatchSpec<T extends object, M extends MethodKeys<T> = MethodKeys<T>> = {
	id: string;
	target: T;
	method: M;
	wrap: (original: T[M]) => T[M];
};

export function applyPatch<T extends object, M extends MethodKeys<T>>(
	plugin: Plugin,
	spec: PatchSpec<T, M>,
): boolean {
	const original = spec.target[spec.method];
	if (typeof original !== "function") {
		return false;
	}

	const marker = Symbol.for(`cosense-card-links.patch.${spec.id}`);
	const targetWithMarker = spec.target as T & Record<symbol, boolean>;
	if (targetWithMarker[marker]) {
		return false;
	}

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const uninstaller = around(spec.target, {
		[spec.method]: (next: T[M]) => {
			const safeNext = next as AnyFn;
			const safeWrapped = spec.wrap(next) as AnyFn;
			return function patched(this: unknown, ...args: unknown[]) {
				try {
					return safeWrapped.apply(this, args);
				} catch (error) {
					console.error(`[CCL] Patch failed: ${spec.id}`, error);
					return safeNext.apply(this, args);
				}
			} as T[M];
		},
	} as any);

	Object.defineProperty(targetWithMarker, marker, {
		value: true,
		configurable: true,
	});

	plugin.register(() => {
		try {
			uninstaller();
		} finally {
			delete targetWithMarker[marker];
		}
	});
	return true;
}
