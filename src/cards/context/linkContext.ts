import type { TFile, Pos, CachedMetadata, App } from "obsidian";
import type { IndexedLink } from "indexing/model";
import { createContext } from "svelte";
import type { PluginSettings } from "settings/model";
import type { PreviewData, PreviewRequestOptions } from "card-preview/types";
import type { PreviewRuntime } from "card-preview/runtime/previewRuntime";
import type { PreviewRevisionReader } from "card-preview/PreviewRevisionState.svelte";
export type {
	PreviewData,
	PreviewDomRenderer,
	PreviewRequestOptions,
} from "card-preview/types";
export type { LinkUtilitiesContext } from "cards/context/linkUtilities";
import type { LinkUtilitiesContext } from "cards/context/linkUtilities";
import type { SearchContentMatch } from "search/searchTypes";

export interface BookmarksState {
	filePaths: Set<string>;
	orderedFilePaths: string[];
	isBookmarked: (path: string | null | undefined) => boolean;
}

export type HighlightMode = "auto" | "force" | "suppress";

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
		link: IndexedLink,
		options?: LinkInteractionOptions,
	) => void;
	onHop2Click: (
		event: MouseEvent | KeyboardEvent,
		link: IndexedLink,
		options?: LinkInteractionOptions,
	) => void;
	onTagClick: (tag: string) => void;
	onLinkHover?: (
		event: MouseEvent,
		link: IndexedLink,
		targetFile: TFile,
		isOutgoingLink?: boolean,
		options?: LinkInteractionOptions,
	) => void;
}

export type LinkContext = LinkUtilitiesContext & LinkInteractionContext;

/** Store capabilities consumed by UI context users. */
export interface AppContextApplicationStore {
	readonly settings: PluginSettings;
	readonly previewState?: Pick<PreviewRevisionReader, "getRenderVersion">;
	setSettings(settings: PluginSettings): void;
}

export interface AppContext {
	linkContext: LinkContext;
	applicationStore: AppContextApplicationStore;
	app: App;
	bookmarks: BookmarksState;
	/** Runtime-owned preview factory; optional for isolated Svelte consumers. */
	previewRuntime?: PreviewRuntime;
	resolveSearchMatchPosition?: (
		query: string,
		file: TFile | null | undefined,
	) => Pos | undefined | Promise<Pos | undefined>;
	resolveSearchMatchOffset?: (
		query: string,
		file: TFile | null | undefined,
	) => SearchContentMatch | undefined;
	updateSetting?: <K extends keyof PluginSettings>(
		key: K,
		value: PluginSettings[K],
	) => Promise<void>;
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
