import type { TFile, Pos, CachedMetadata, App } from "obsidian";
import type { TwoHopIndexedLink } from "types/domain";
import { createContext } from "svelte";
import type { ApplicationStore } from "ui/stores/ApplicationStore.svelte";
import type {
	HighlightMode,
	PreviewData,
	PreviewRequestOptions,
} from "features/preview/public-types";
import type { PreviewRuntime } from "features/preview/runtime/previewRuntime";
export type {
	HighlightMode,
	PreviewData,
	PreviewDomRenderer,
	PreviewRequestOptions,
} from "features/preview/public-types";
export type { LinkUtilitiesContext } from "types/linkContext";
import type { LinkUtilitiesContext } from "types/linkContext";

export interface BookmarksState {
	filePaths: Set<string>;
	orderedFilePaths: string[];
	isBookmarked: (path: string | null | undefined) => boolean;
}

export interface LinkInteractionOptions {
	highlightMode?: HighlightMode;
	preferredPosition?: Pos;
}

export interface LinkInteractionContext {
	onOpenFile: (
		event: MouseEvent | KeyboardEvent,
		file: TFile,
		position?: Pos,
		options?: LinkInteractionOptions,
	) => void;
	onHop1Click: (
		event: MouseEvent | KeyboardEvent,
		link: TwoHopIndexedLink,
		options?: LinkInteractionOptions,
	) => void;
	onHop2Click: (
		event: MouseEvent | KeyboardEvent,
		link: TwoHopIndexedLink,
		options?: LinkInteractionOptions,
	) => void;
	onTagClick: (tag: string) => void;
	onLinkHover?: (
		event: MouseEvent,
		link: TwoHopIndexedLink,
		targetFile: TFile,
		isOutgoingLink?: boolean,
		options?: LinkInteractionOptions,
	) => void;
}

export type LinkContext = LinkUtilitiesContext & LinkInteractionContext;

export interface AppContext {
	linkContext: LinkContext;
	applicationStore: ApplicationStore;
	app: App;
	bookmarks: BookmarksState;
	/** Runtime-owned preview factory; optional for isolated Svelte consumers. */
	previewRuntime?: PreviewRuntime;
	resolveSearchMatchPosition?: (
		query: string,
		file: TFile | null | undefined,
	) => Pos | undefined;
	updateSetting?: <K extends string>(key: K, value: unknown) => Promise<void>;
}

export const [useAppContext, setAppContext] = createContext<AppContext>();
export const [useLinkContext, setLinkContext] = createContext<LinkContext>();
const [getLazyLoaderCache, setLazyLoaderCache] = createContext<Set<string>>();
export { setLazyLoaderCache };

export function useLazyLoaderCache(): Set<string> | undefined {
	try {
		return getLazyLoaderCache();
	} catch {
		return undefined;
	}
}
