import type { DataUpdateContext } from "core/indexing/index-service/IndexEvents";

export function createGuardedIndexUpdateHandler(options: {
	isReady: () => boolean;
	shouldRefresh: (context?: DataUpdateContext) => boolean;
	refresh: (context?: DataUpdateContext) => void;
}): (context?: DataUpdateContext) => void {
	return (context?: DataUpdateContext) => {
		if (!options.isReady()) {
			return;
		}
		if (!options.shouldRefresh(context)) {
			return;
		}
		options.refresh(context);
	};
}
