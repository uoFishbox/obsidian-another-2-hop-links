import type { PluginSettings } from "features/settings/model";

export function shouldHighlight(
	_event: MouseEvent | KeyboardEvent,
	settings: PluginSettings,
): boolean {
	switch (settings.highlightOnOpen) {
		case "always":
			return true;
		case "never":
		default:
			return false;
	}
}
