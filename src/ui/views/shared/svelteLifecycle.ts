import { unmount } from "svelte";

export type SvelteComponentInstance = object;

export function cleanupSvelteAndStore<
	TStore extends { destroy: () => void },
>(
	component: SvelteComponentInstance | undefined,
	store: TStore | undefined,
): [undefined, undefined] {
	if (component) {
		unmount(component);
	}
	if (store) {
		store.destroy();
	}
	return [undefined, undefined];
}
