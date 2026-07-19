import type { Snippet } from "svelte";
import type { SectionHeaderInteractionDescriptor } from "ui/interactions/interactionTypes";
import type { PluginSettings } from "features/settings/model";
import type { RenderRevision } from "ui/virtualization/renderRevision";

export interface SectionConfig<T> {
	title: string;
	sectionId: string;
	className?: string;
	getKey: (item: T, index: number) => string;
	headerIcon?: Snippet;
}

export interface ClickableHeaderExtraProps {
	className?: string;
	draggable?: boolean;
	directory?: string | null;
	settings?: PluginSettings;
	interactionId?: string;
	interactionKind?: "sectionHeader";
	interactionDescriptor?: SectionHeaderInteractionDescriptor;
	onClick?: () => void;
}

export interface SectionRenderDescriptor<T, G> {
	readonly section: G;
	readonly sectionKey: string;
	readonly title: string;
	readonly sectionId: string;
	readonly paginationKey?: string;
	readonly totalCount: number;
	readonly loadedCount: number;
	readonly getItems: () => readonly T[];
	readonly getItem?: (index: number) => T | undefined;
	readonly headerProps: ClickableHeaderExtraProps;
	readonly headerRenderRevision?: RenderRevision;
}
