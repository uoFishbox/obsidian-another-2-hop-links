import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InteractionRegistry } from "../interactionRegistry";

const {
	handleDelegatedEnterMock,
	handleDelegatedAnchorSyncMock,
	handleDelegatedModifierKeyMock,
	handleDelegatedLeaveMock,
	handleDelegatedPointerMoveMock,
	destroyMock,
	buildShadowHoverLinkSpecMock,
} = vi.hoisted(() => ({
	handleDelegatedEnterMock: vi.fn(),
	handleDelegatedAnchorSyncMock: vi.fn(),
	handleDelegatedModifierKeyMock: vi.fn(),
	handleDelegatedLeaveMock: vi.fn(),
	handleDelegatedPointerMoveMock: vi.fn(),
	destroyMock: vi.fn(),
	buildShadowHoverLinkSpecMock: vi.fn((descriptor?: { interactionId?: string }) =>
		descriptor?.interactionId
			? {
					linktext: descriptor.interactionId,
					sourcePath: "note.md",
				}
			: null,
	),
}));

vi.mock("features/preview/shadow-hover/controller", () => ({
	ShadowHoverControllerImpl: class MockShadowHoverControllerImpl {
		handleDelegatedEnter = handleDelegatedEnterMock;
		handleDelegatedAnchorSync = handleDelegatedAnchorSyncMock;
		handleDelegatedModifierKey = handleDelegatedModifierKeyMock;
		handleDelegatedLeave = handleDelegatedLeaveMock;
		handleDelegatedPointerMove = handleDelegatedPointerMoveMock;
		closeActivePopover = vi.fn();
		syncActivePopover = vi.fn();
		destroy = destroyMock;
	},
}));

vi.mock("../shadowHoverLinkSpec", () => ({
	buildShadowHoverLinkSpec: buildShadowHoverLinkSpecMock,
}));

import { installShadowHoverPopoverBridge } from "../shadowHoverPopoverBridge";

describe("shadowHoverPopoverBridge", () => {
	beforeEach(() => {
		handleDelegatedEnterMock.mockReset();
		handleDelegatedAnchorSyncMock.mockReset();
		handleDelegatedModifierKeyMock.mockReset();
		handleDelegatedLeaveMock.mockReset();
		handleDelegatedPointerMoveMock.mockReset();
		destroyMock.mockReset();
		buildShadowHoverLinkSpecMock.mockClear();
	});

	afterEach(() => {
		document.body.innerHTML = "";
	});

	it("enters the first hovered interaction from mouseover using composed path resolution", () => {
		const { shadowRoot, dispose } = installBridge();
		const interaction = createInteractionElement("item:first");
		const child = document.createElement("span");
		interaction.append(child);
		shadowRoot.append(interaction);

		child.dispatchEvent(
			new MouseEvent("mouseover", {
				bubbles: true,
				composed: true,
			}),
		);

		expect(handleDelegatedEnterMock).toHaveBeenCalledTimes(1);
		expect(handleDelegatedEnterMock).toHaveBeenCalledWith(
			interaction,
			"item:first",
			expect.any(MouseEvent),
		);

		dispose();
	});

	it("does not leave the old interaction immediately during ctrl/meta anchor handoff", () => {
		const { shadowRoot, dispose } = installBridge();
		const first = createInteractionElement("item:first");
		const second = createInteractionElement("item:second");
		shadowRoot.append(first, second);

		first.dispatchEvent(
			new MouseEvent("mouseover", {
				bubbles: true,
				composed: true,
			}),
		);
		second.dispatchEvent(
			new MouseEvent("mouseover", {
				bubbles: true,
				composed: true,
				relatedTarget: first,
				ctrlKey: true,
			}),
		);

		expect(handleDelegatedLeaveMock).not.toHaveBeenCalledWith(first);
		expect(handleDelegatedEnterMock).toHaveBeenCalledTimes(2);
		expect(handleDelegatedEnterMock).toHaveBeenLastCalledWith(
			second,
			"item:second",
			expect.any(MouseEvent),
		);

		dispose();
	});

	it("does not leave the old interaction on ctrl/meta mouseout toward another interaction", () => {
		const { shadowRoot, dispose } = installBridge();
		const first = createInteractionElement("item:first");
		const second = createInteractionElement("item:second");
		shadowRoot.append(first, second);

		first.dispatchEvent(
			new MouseEvent("mouseover", {
				bubbles: true,
				composed: true,
			}),
		);
		first.dispatchEvent(
			new MouseEvent("mouseout", {
				bubbles: true,
				composed: true,
				relatedTarget: second,
				ctrlKey: true,
			}),
		);

		expect(handleDelegatedLeaveMock).not.toHaveBeenCalledWith(first);

		dispose();
	});

	it("forwards pointermove only when modifier state arms a retrigger", () => {
		const { shadowRoot, dispose } = installBridge();
		const interaction = createInteractionElement("item:first");
		const child = document.createElement("span");
		interaction.append(child);
		shadowRoot.append(interaction);

		interaction.dispatchEvent(
			new MouseEvent("mouseover", {
				bubbles: true,
				composed: true,
			}),
		);
		child.dispatchEvent(
			new PointerEvent("pointermove", {
				bubbles: true,
				composed: true,
				ctrlKey: true,
			}),
		);

		expect(handleDelegatedPointerMoveMock).toHaveBeenCalledTimes(1);
		expect(handleDelegatedPointerMoveMock).toHaveBeenCalledWith(
			interaction,
			"item:first",
			expect.any(PointerEvent),
		);

		dispose();
	});

	it("syncs the controller when mouseover repeats on the active interaction", () => {
		const { shadowRoot, dispose } = installBridge();
		const interaction = createInteractionElement("item:first");
		const child = document.createElement("span");
		interaction.append(child);
		shadowRoot.append(interaction);

		interaction.dispatchEvent(
			new MouseEvent("mouseover", {
				bubbles: true,
				composed: true,
			}),
		);
		child.dispatchEvent(
			new MouseEvent("mouseover", {
				bubbles: true,
				composed: true,
			}),
		);

		expect(handleDelegatedEnterMock).toHaveBeenCalledTimes(1);
		expect(handleDelegatedAnchorSyncMock).toHaveBeenCalledTimes(1);
		expect(handleDelegatedAnchorSyncMock).toHaveBeenCalledWith(
			interaction,
			"item:first",
			expect.any(MouseEvent),
		);

		dispose();
	});

	it("passes interaction metadata through anchor sync after DOM replacement", () => {
		const { shadowRoot, dispose } = installBridge();
		const first = createInteractionElement("item:first");
		const second = createInteractionElement("item:first");
		shadowRoot.append(first, second);

		first.dispatchEvent(
			new MouseEvent("mouseover", {
				bubbles: true,
				composed: true,
			}),
		);
		second.dispatchEvent(
			new MouseEvent("mouseover", {
				bubbles: true,
				composed: true,
				relatedTarget: first,
			}),
		);

		expect(handleDelegatedEnterMock).toHaveBeenCalledTimes(1);
		expect(handleDelegatedAnchorSyncMock).toHaveBeenCalledTimes(1);
		expect(handleDelegatedAnchorSyncMock).toHaveBeenCalledWith(
			second,
			"item:first",
			expect.any(MouseEvent),
		);

		dispose();
	});

	it("resolves hover targets from a foreign window shadow root", () => {
		const frame = document.createElement("iframe");
		document.body.append(frame);
		const foreignDocument = frame.contentDocument;
		const foreignWindow = frame.contentWindow;
		expect(foreignDocument).toBeTruthy();
		expect(foreignWindow).toBeTruthy();
		if (!foreignDocument || !foreignWindow) {
			return;
		}

		const host = foreignDocument.createElement("div");
		foreignDocument.body.append(host);
		const shadowRoot = host.attachShadow({ mode: "open" });
		const dispose = installShadowHoverPopoverBridge({
			shadowRoot,
			registry: createRegistryStub(),
			appContext: { app: {} } as never,
		});
		const interaction = createInteractionElement("item:first", foreignDocument);
		const child = foreignDocument.createElement("span");
		interaction.append(child);
		shadowRoot.append(interaction);

		const event = new (foreignWindow as any).MouseEvent("mouseover", {
			bubbles: true,
			composed: true,
		});
		expect(event).not.toBeInstanceOf(Event);
		child.dispatchEvent(event);

		expect(handleDelegatedEnterMock).toHaveBeenCalledTimes(1);
		expect(handleDelegatedEnterMock).toHaveBeenCalledWith(
			interaction,
			"item:first",
			event,
		);

		dispose();
	});
});

function createRegistryStub(
	descriptors: Record<
		string,
		{ interactionId: string; hoverPreviewEnabled?: boolean }
	> = {},
): InteractionRegistry {
	return {
		createInteractionToken: vi.fn((semanticKey: string) => semanticKey),
		register: vi.fn(),
		unregister: vi.fn(),
		syncInteractionDescriptors: vi.fn(),
		syncInteractionDescriptorResolvers: vi.fn(),
		syncInteractionDescriptorResolverProvider: vi.fn(),
		resolve: vi.fn(
			(interactionId: string) =>
				(descriptors[interactionId] ?? { interactionId }) as any,
		),
		clear: vi.fn(),
	};
}

function createInteractionElement(
	interactionId: string,
	doc: Document = document,
): HTMLDivElement {
	const element = doc.createElement("div");
	element.dataset.cclInteractionId = interactionId;
	return element;
}

function installBridge(registry = createRegistryStub()): {
	shadowRoot: ShadowRoot;
	dispose: () => void;
} {
	const host = document.createElement("div");
	document.body.append(host);
	const shadowRoot = host.attachShadow({
		mode: "open",
	});
	const dispose = installShadowHoverPopoverBridge({
		shadowRoot,
		registry,
		appContext: { app: {} } as never,
	});
	return { shadowRoot, dispose };
}
