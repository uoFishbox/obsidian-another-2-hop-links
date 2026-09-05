import { getFocusableResultTarget } from "cards/navigation/resultTargets";
import type {
	NavigationDirection,
	SequentialNavigationDirection,
} from "cards/navigation/types";
import { isHTMLElementLike } from "shared/ui/dom/realmSafeDom";

interface DelegatedKeyboardInteractions {
	handleKeyDown: (event: KeyboardEvent) => void;
}

interface CardGridKeyboardOptions {
	delegatedInteractions: DelegatedKeyboardInteractions;
	moveFocusWithinList: (
		currentTarget: HTMLElement,
		direction: NavigationDirection,
	) => Promise<boolean>;
	prepareSequentialFocusMove: (
		currentTarget: HTMLElement,
		direction: SequentialNavigationDirection,
	) => (() => Promise<boolean>) | null;
}

export const getArrowNavigationDirection = (
	key: string,
): NavigationDirection | null => {
	switch (key.toLowerCase()) {
		case "arrowdown":
			return "down";
		case "arrowup":
			return "up";
		case "arrowleft":
			return "left";
		case "arrowright":
			return "right";
		default:
			return null;
	}
};

function consumeNavigationEvent(event: KeyboardEvent): void {
	event.preventDefault();
	event.stopPropagation();
}

export const createCardGridKeyboardHandler = (
	options: CardGridKeyboardOptions,
): ((event: KeyboardEvent) => Promise<void>) => {
	return async (event: KeyboardEvent): Promise<void> => {
		if (event.ctrlKey || event.metaKey || event.altKey) {
			options.delegatedInteractions.handleKeyDown(event);
			return;
		}

		const origin = event.composedPath()[0];
		if (event.key === "Tab" && isHTMLElementLike(origin)) {
			const runSequentialMove = options.prepareSequentialFocusMove(
				origin,
				event.shiftKey ? "backward" : "forward",
			);
			if (!runSequentialMove) {
				options.delegatedInteractions.handleKeyDown(event);
				return;
			}

			consumeNavigationEvent(event);
			await runSequentialMove();
			return;
		}

		const direction = getArrowNavigationDirection(event.key);
		const currentTarget = direction ? getFocusableResultTarget(event) : null;
		if (!direction || !currentTarget) {
			options.delegatedInteractions.handleKeyDown(event);
			return;
		}

		consumeNavigationEvent(event);
		if (!(await options.moveFocusWithinList(currentTarget, direction))) {
			options.delegatedInteractions.handleKeyDown(event);
		}
	};
};
