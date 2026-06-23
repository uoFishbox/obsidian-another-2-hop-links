import type { App } from "obsidian";
import { REQUEST_SEQ_STATE_KEY } from "./internal-constants";
import type { HoverLinkPayloadLike, ShadowHoverSession } from "./internal-types";
import { createRequestHoverParent } from "./session";
import type { ShadowHoverLinkSpec } from "./public-types";
import { debugLog } from "./debug";
import { summarizeNode } from "./dom-utils";
import { enableLogging } from "utils/logger";

export type ShadowPopoverLaunchRequest = {
	session: ShadowHoverSession;
	actualAnchorEl: HTMLElement;
	proxyAnchorEl: HTMLElement;
	event: MouseEvent;
	link: ShadowHoverLinkSpec;
	requestSeq: number;
};

export interface ShadowPopoverLauncher {
	launch(request: ShadowPopoverLaunchRequest): void;
}

export class WorkspaceTriggerPopoverLauncher implements ShadowPopoverLauncher {
	constructor(
		private readonly app: App,
		private readonly sourceId: string,
	) {}

	launch(request: ShadowPopoverLaunchRequest): void {
		const hoverParent = createRequestHoverParent(
			request.session,
			request.requestSeq,
			request.proxyAnchorEl,
			request.actualAnchorEl,
		);
		const payload: HoverLinkPayloadLike = {
			event: request.event,
			source: this.sourceId,
			hoverParent,
			targetEl: request.proxyAnchorEl,
			linktext: request.link.linktext,
			sourcePath: request.link.sourcePath,
			state: {
				...(request.link.state as Record<string, unknown> | undefined),
				[REQUEST_SEQ_STATE_KEY]: request.requestSeq,
			},
		};
		request.session.lastHoverPath = "workspace-trigger";
		if (enableLogging) {
			debugLog(
				request.session,
				"workspace-hover-trigger",
				"Triggering workspace hover-link from shadow target via proxy",
				() => ({
					source: payload.source,
					linktext: payload.linktext,
					sourcePath: payload.sourcePath,
					actualTarget: summarizeNode(request.actualAnchorEl),
					proxyTarget: summarizeNode(payload.targetEl),
					requestSeq: request.requestSeq,
				}),
			);
		}
		this.app.workspace.trigger("hover-link", payload);
	}
}
