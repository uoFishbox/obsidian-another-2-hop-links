import type { VirtualizedItemVisibilityState } from "ui/components/common/virtualizedItemVisibility";

export interface PreviewVisibilityContext extends VirtualizedItemVisibilityState {}

export const PREVIEW_VISIBILITY_CONTEXT_KEY = Symbol("preview-visibility-context");
