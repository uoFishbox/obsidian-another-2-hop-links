import { beforeEach, describe, expect, it, vi } from "vitest";
import { Platform, TFile } from "obsidian";
import { createMockTFile } from "testing/__mocks__/testHelpers";
import { CANVAS_NOTE_DRAG_FORMAT } from "obsidian-integration/workspace/canvasDragData";
import type { CardItem } from "cards/CardItem";
import { createDelegatedInteractionDispatcher } from "../delegatedDispatcher";
import { createInteractionRegistry } from "../interactionRegistry";
import type { AppContext, LinkContext } from "cards/context/linkContext";
import { createInteractionHandle } from "../interactionTypes";
import type {
	SectionHeaderInteractionDescriptor,
	ItemInteractionDescriptor,
} from "../interactionTypes";
import { setLightweightCardDragImage } from "../delegatedDispatcher";

vi.mock("obsidian", async () => {
	const actual = await vi.importActual<typeof import("obsidian")>("obsidian");
	return {
		...actual,
		Platform: {
			isMobile: false,
		},
		TFile: class {},
	};
});

const SOURCE_FILE_PATH = "notes/source-note.md";
const TARGET_FILE_PATH = "notes/target-note.md";
const FOREIGN_TARGET_FILE_PATH = "notes/foreign-target.md";
const INTERACTION_ID = "token-37";
const SECTION_INTERACTION_ID = "section-token-19";
const LINK_RAW_TEXT = "target-reference";
const DRAG_RAW_TEXT = "visible-alias";
const SEARCH_QUERY = "needle-query";

function createLinkContext() {
	return {
		onOpenFile: vi.fn(),
		onHop1Click: vi.fn(),
		onHop2Click: vi.fn(),
		onTagClick: vi.fn(),
		onLinkHover: vi.fn(),
		onShowFileMenu: vi.fn(),
		resolveFile: vi.fn(),
		buildWikiLink: vi.fn(
			(targetFile: TFile | null, rawText: string) =>
				`[[${targetFile?.path ?? "unresolved"}|${rawText}]]`,
		),
		fileToLinktext: vi.fn(),
		sourceFile: createMockTFile(SOURCE_FILE_PATH),
		getMetadata: vi.fn(() => null),
		getPreview: vi.fn(async () => ({ type: "empty", content: "" }) as const),
	} satisfies LinkContext;
}

function createAppContext(linkContext: LinkContext): AppContext {
	return {
		linkContext,
		applicationStore: {} as any,
		app: {} as any,
		bookmarks: {
			filePaths: new Set<string>(),
			orderedFilePaths: [],
			isBookmarked: () => false,
		},
		resolveSearchMatchPosition: vi.fn(() => ({
			start: { line: 10, col: 2, offset: 0 },
			end: { line: 10, col: 8, offset: 0 },
		})),
	};
}

function attachDispatcher(
	root: HTMLElement,
	dispatcher: ReturnType<typeof createDelegatedInteractionDispatcher>,
) {
	root.addEventListener("click", dispatcher.handleClick as EventListener);
	root.addEventListener("mousedown", dispatcher.handleMouseDown as EventListener);
	root.addEventListener("contextmenu", dispatcher.handleContextMenu as EventListener);
	root.addEventListener("mouseover", dispatcher.handleMouseOver as EventListener);
	root.addEventListener("mouseout", dispatcher.handleMouseOut as EventListener);
	root.addEventListener("mouseleave", dispatcher.handleMouseLeave as EventListener);
	root.addEventListener("keydown", dispatcher.handleKeyDown as EventListener);
	root.addEventListener("dragstart", dispatcher.handleDragStart as EventListener);
	root.addEventListener("touchstart", dispatcher.handleTouchStart as EventListener);
	root.addEventListener("touchmove", dispatcher.handleTouchMove as EventListener);
	root.addEventListener("touchend", dispatcher.handleTouchEnd as EventListener);
	root.addEventListener("touchcancel", dispatcher.handleTouchEnd as EventListener);
}

function createTouchEvent(
	type: string,
	touches: Array<Pick<Touch, "clientX" | "clientY" | "screenX" | "screenY">>,
): TouchEvent {
	const event = new Event(type, {
		bubbles: true,
		cancelable: true,
		composed: true,
	}) as TouchEvent;
	Object.defineProperty(event, "touches", {
		value: touches,
	});
	return event;
}

function createItemDescriptor(item: CardItem, file: TFile): ItemInteractionDescriptor {
	return {
		interactionId: INTERACTION_ID,
		kind: "item",
		item,
		targetFile: file,
		dragRawText: DRAG_RAW_TEXT,
		filePathForDrag: file.path,
		settings: {
			mobileLongPressAction: "preview",
		} as any,
		searchQuery: SEARCH_QUERY,
	};
}

function createSectionDescriptor(
	targetFile: TFile,
): SectionHeaderInteractionDescriptor {
	return {
		interactionId: SECTION_INTERACTION_ID,
		kind: "sectionHeader",
		link: {
			rawText: LINK_RAW_TEXT,
			path: targetFile.path,
			isUnresolved: false,
			sourceFile: createMockTFile(SOURCE_FILE_PATH),
		},
		isOutgoingLink: true,
		targetFile,
		dragRawText: DRAG_RAW_TEXT,
		filePathForDrag: targetFile.path,
		settings: {
			mobileLongPressAction: "preview",
		} as any,
	};
}

describe("delegated interaction dispatcher", () => {
	let root: HTMLDivElement;

	beforeEach(() => {
		vi.useRealTimers();
		Platform.isMobile = false;
		root = document.createElement("div");
		document.body.innerHTML = "";
		document.body.append(root);
	});

	it("dispatches click for item interactions with resolved search options", () => {
		const linkContext = createLinkContext();
		const appContext = createAppContext(linkContext);
		const registry = createInteractionRegistry();
		const file = createMockTFile(TARGET_FILE_PATH);
		const item = { type: "file", data: file } as CardItem;
		const descriptor = createItemDescriptor(item, file);
		const interactionHandle = createInteractionHandle();
		registry.register(interactionHandle, descriptor);

		const dispatcher = createDelegatedInteractionDispatcher({
			registry,
			linkContext,
			appContext,
		});
		attachDispatcher(root, dispatcher);

		const element = document.createElement("div");
		element.dataset.cclInteractionHandle = interactionHandle;
		root.append(element);

		element.dispatchEvent(new MouseEvent("click", { bubbles: true }));

		expect(appContext.resolveSearchMatchPosition).toHaveBeenCalledWith(
			SEARCH_QUERY,
			file,
		);
		expect(linkContext.onOpenFile).toHaveBeenCalledWith(
			expect.any(MouseEvent),
			file,
			expect.objectContaining({
				start: expect.objectContaining({ line: 10 }),
			}),
			{
				highlightMode: "force",
				preferredPosition: expect.objectContaining({
					start: expect.objectContaining({ line: 10 }),
				}),
			},
		);
	});

	it("resolves an offset-backed position only after activation", async () => {
		const linkContext = createLinkContext();
		const appContext = createAppContext(linkContext);
		let resolvePosition!: (position: {
			start: { line: number; col: number; offset: number };
			end: { line: number; col: number; offset: number };
		}) => void;
		const positionPromise = new Promise<{
			start: { line: number; col: number; offset: number };
			end: { line: number; col: number; offset: number };
		}>((resolve) => {
			resolvePosition = resolve;
		});
		appContext.resolveSearchMatchPosition = vi.fn(() => positionPromise);
		const registry = createInteractionRegistry();
		const file = createMockTFile(TARGET_FILE_PATH);
		const descriptor = createItemDescriptor(
			{ type: "file", data: file } as CardItem,
			file,
		);
		const interactionHandle = createInteractionHandle();
		registry.register(interactionHandle, descriptor);
		const dispatcher = createDelegatedInteractionDispatcher({
			registry,
			linkContext,
			appContext,
		});
		attachDispatcher(root, dispatcher);
		const element = document.createElement("div");
		element.dataset.cclInteractionHandle = interactionHandle;
		root.append(element);

		element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		expect(linkContext.onOpenFile).not.toHaveBeenCalled();

		resolvePosition({
			start: { line: 42, col: 3, offset: 500 },
			end: { line: 42, col: 9, offset: 506 },
		});
		await positionPromise;
		await Promise.resolve();
		expect(linkContext.onOpenFile).toHaveBeenCalledWith(
			expect.any(MouseEvent),
			file,
			expect.objectContaining({
				start: expect.objectContaining({ line: 42, offset: 500 }),
			}),
			expect.objectContaining({ highlightMode: "force" }),
		);
	});

	it("resolves delegated events from descendants through the card box", () => {
		const linkContext = createLinkContext();
		const appContext = createAppContext(linkContext);
		const registry = createInteractionRegistry();
		const file = createMockTFile(TARGET_FILE_PATH);
		const descriptor = createItemDescriptor(
			{ type: "file", data: file } as CardItem,
			file,
		);
		const interactionHandle = createInteractionHandle();
		registry.register(interactionHandle, descriptor);

		const dispatcher = createDelegatedInteractionDispatcher({
			registry,
			linkContext,
			appContext,
		});
		attachDispatcher(root, dispatcher);

		const card = document.createElement("div");
		card.className = "cosense-card-links__box";
		card.dataset.cclInteractionHandle = interactionHandle;
		const child = document.createElement("span");
		child.className = "cosense-card-links__box-title";
		card.append(child);
		root.append(card);

		child.dispatchEvent(new MouseEvent("click", { bubbles: true }));

		expect(linkContext.onOpenFile).toHaveBeenCalledTimes(1);
	});

	it("dispatches each DOM binding independently when semantic IDs are shared", () => {
		const linkContext = createLinkContext();
		const appContext = createAppContext(linkContext);
		const registry = createInteractionRegistry();
		const firstFile = createMockTFile(TARGET_FILE_PATH);
		const secondFile = createMockTFile(FOREIGN_TARGET_FILE_PATH);
		const firstDescriptor = createItemDescriptor(
			{ type: "file", data: firstFile } as CardItem,
			firstFile,
		);
		const secondDescriptor = createItemDescriptor(
			{ type: "file", data: secondFile } as CardItem,
			secondFile,
		);
		const firstHandle = createInteractionHandle();
		const secondHandle = createInteractionHandle();
		registry.register(firstHandle, firstDescriptor);
		registry.register(secondHandle, secondDescriptor);
		const dispatcher = createDelegatedInteractionDispatcher({
			registry,
			linkContext,
			appContext,
		});
		attachDispatcher(root, dispatcher);

		const firstElement = document.createElement("div");
		firstElement.dataset.cclInteractionHandle = firstHandle;
		const secondElement = document.createElement("div");
		secondElement.dataset.cclInteractionHandle = secondHandle;
		root.append(firstElement, secondElement);

		firstElement.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		secondElement.dispatchEvent(new MouseEvent("click", { bubbles: true }));

		expect(linkContext.onOpenFile).toHaveBeenNthCalledWith(
			1,
			expect.any(MouseEvent),
			firstFile,
			expect.anything(),
			expect.anything(),
		);
		expect(linkContext.onOpenFile).toHaveBeenNthCalledWith(
			2,
			expect.any(MouseEvent),
			secondFile,
			expect.anything(),
			expect.anything(),
		);
	});

	it("dispatches middle-click activation and prevents default propagation", () => {
		const linkContext = createLinkContext();
		const appContext = createAppContext(linkContext);
		const registry = createInteractionRegistry();
		const file = createMockTFile(TARGET_FILE_PATH);
		const descriptor = createItemDescriptor(
			{ type: "file", data: file } as CardItem,
			file,
		);
		const interactionHandle = createInteractionHandle();
		registry.register(interactionHandle, descriptor);
		const dispatcher = createDelegatedInteractionDispatcher({
			registry,
			linkContext,
			appContext,
		});

		const element = document.createElement("div");
		element.dataset.cclInteractionHandle = interactionHandle;

		attachDispatcher(root, dispatcher);
		root.append(element);

		element.dispatchEvent(
			new MouseEvent("mousedown", {
				bubbles: true,
				button: 1,
			}),
		);

		expect(linkContext.onOpenFile).toHaveBeenCalledTimes(1);
	});

	it("suppresses repeated mouseover dispatches for the same interaction until the pointer leaves the root", () => {
		const linkContext = createLinkContext();
		const appContext = createAppContext(linkContext);
		const registry = createInteractionRegistry();
		const file = createMockTFile(TARGET_FILE_PATH);
		const descriptor = createItemDescriptor(
			{ type: "file", data: file } as CardItem,
			file,
		);
		const interactionHandle = createInteractionHandle();
		registry.register(interactionHandle, descriptor);

		const dispatcher = createDelegatedInteractionDispatcher({
			registry,
			linkContext,
			appContext,
		});
		attachDispatcher(root, dispatcher);

		const element = document.createElement("div");
		element.dataset.cclInteractionHandle = interactionHandle;
		root.append(element);

		element.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
		element.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));

		expect(linkContext.onLinkHover).toHaveBeenCalledTimes(1);
		const firstHoverEvent = vi.mocked(linkContext.onLinkHover).mock.calls[0]?.[0];
		expect(firstHoverEvent.currentTarget).toBe(element);
		expect(firstHoverEvent.target).toBe(element);

		root.dispatchEvent(new MouseEvent("mouseleave", { bubbles: true }));
		element.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));

		expect(linkContext.onLinkHover).toHaveBeenCalledTimes(2);
	});

	it("suppresses hover preview when disabled while keeping click activation", () => {
		const linkContext = createLinkContext();
		const appContext = createAppContext(linkContext);
		const registry = createInteractionRegistry();
		const file = createMockTFile(TARGET_FILE_PATH);
		const descriptor = {
			...createItemDescriptor({ type: "file", data: file } as CardItem, file),
			hoverPreviewEnabled: false,
		} satisfies ItemInteractionDescriptor;
		const interactionHandle = createInteractionHandle();
		registry.register(interactionHandle, descriptor);

		const dispatcher = createDelegatedInteractionDispatcher({
			registry,
			linkContext,
			appContext,
		});
		attachDispatcher(root, dispatcher);

		const element = document.createElement("div");
		element.dataset.cclInteractionHandle = interactionHandle;
		root.append(element);

		element.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
		element.dispatchEvent(new MouseEvent("click", { bubbles: true }));

		expect(linkContext.onLinkHover).not.toHaveBeenCalled();
		expect(linkContext.onOpenFile).toHaveBeenCalledTimes(1);
	});

	it("keeps keyboard activation working for Enter and Space", () => {
		const linkContext = createLinkContext();
		const appContext = createAppContext(linkContext);
		const registry = createInteractionRegistry();
		const file = createMockTFile(TARGET_FILE_PATH);
		const descriptor = createItemDescriptor(
			{ type: "file", data: file } as CardItem,
			file,
		);
		const interactionHandle = createInteractionHandle();
		registry.register(interactionHandle, descriptor);

		const dispatcher = createDelegatedInteractionDispatcher({
			registry,
			linkContext,
			appContext,
		});
		attachDispatcher(root, dispatcher);

		const element = document.createElement("div");
		element.dataset.cclInteractionHandle = interactionHandle;
		root.append(element);

		element.dispatchEvent(
			new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }),
		);
		element.dispatchEvent(
			new KeyboardEvent("keydown", { bubbles: true, key: " " }),
		);

		expect(linkContext.onOpenFile).toHaveBeenCalledTimes(2);
		expect(linkContext.onOpenFile).toHaveBeenNthCalledWith(
			1,
			expect.any(KeyboardEvent),
			file,
			expect.objectContaining({
				start: expect.objectContaining({ line: 10 }),
			}),
			{
				highlightMode: "force",
				preferredPosition: expect.objectContaining({
					start: expect.objectContaining({ line: 10 }),
				}),
			},
		);
		expect(linkContext.onOpenFile).toHaveBeenNthCalledWith(
			2,
			expect.any(KeyboardEvent),
			file,
			expect.objectContaining({
				start: expect.objectContaining({ line: 10 }),
			}),
			{
				highlightMode: "force",
				preferredPosition: expect.objectContaining({
					start: expect.objectContaining({ line: 10 }),
				}),
			},
		);
	});

	it("consumes long-press follow-up clicks and clears the marker", () => {
		const linkContext = createLinkContext();
		const appContext = createAppContext(linkContext);
		const registry = createInteractionRegistry();
		const file = createMockTFile(TARGET_FILE_PATH);
		const descriptor = createItemDescriptor(
			{ type: "file", data: file } as CardItem,
			file,
		);
		const interactionHandle = createInteractionHandle();
		registry.register(interactionHandle, descriptor);

		const dispatcher = createDelegatedInteractionDispatcher({
			registry,
			linkContext,
			appContext,
		});
		attachDispatcher(root, dispatcher);

		const element = document.createElement("div");
		element.dataset.cclInteractionHandle = interactionHandle;
		element.dataset.cclLongPressed = "1";
		root.append(element);

		element.dispatchEvent(new MouseEvent("click", { bubbles: true }));

		expect(linkContext.onOpenFile).not.toHaveBeenCalled();
		expect(element.dataset.cclLongPressed).toBeUndefined();
	});

	it("delegates mobile touch long-press preview from the root", () => {
		vi.useFakeTimers();
		Platform.isMobile = true;
		const linkContext = createLinkContext();
		const appContext = createAppContext(linkContext);
		const registry = createInteractionRegistry();
		const file = createMockTFile(TARGET_FILE_PATH);
		const descriptor = createItemDescriptor(
			{ type: "file", data: file } as CardItem,
			file,
		);
		const interactionHandle = createInteractionHandle();
		registry.register(interactionHandle, descriptor);

		const dispatcher = createDelegatedInteractionDispatcher({
			registry,
			linkContext,
			appContext,
		});
		attachDispatcher(root, dispatcher);

		const element = document.createElement("div");
		element.dataset.cclInteractionHandle = interactionHandle;
		root.append(element);

		element.dispatchEvent(
			createTouchEvent("touchstart", [
				{ clientX: 20, clientY: 30, screenX: 120, screenY: 130 },
			]),
		);
		vi.advanceTimersByTime(500);

		expect(element.dataset.cclLongPressed).toBe("1");
		expect(linkContext.onLinkHover).toHaveBeenCalledTimes(1);
		expect(linkContext.onOpenFile).toHaveBeenCalledTimes(0);

		element.dispatchEvent(createTouchEvent("touchend", []));
		element.dispatchEvent(new MouseEvent("click", { bubbles: true }));

		expect(linkContext.onOpenFile).not.toHaveBeenCalled();
		expect(element.dataset.cclLongPressed).toBeUndefined();
		Platform.isMobile = false;
	});

	it("dispatches context menu and drag data from the registered descriptor", () => {
		const linkContext = createLinkContext();
		const appContext = createAppContext(linkContext);
		const registry = createInteractionRegistry();
		const file = createMockTFile(TARGET_FILE_PATH);
		const descriptor = createSectionDescriptor(file);
		const interactionHandle = createInteractionHandle();
		registry.register(interactionHandle, descriptor);
		const dispatcher = createDelegatedInteractionDispatcher({
			registry,
			linkContext,
			appContext,
		});

		const element = document.createElement("div");
		element.dataset.cclInteractionHandle = interactionHandle;

		attachDispatcher(root, dispatcher);
		root.append(element);

		element.dispatchEvent(
			new MouseEvent("contextmenu", {
				bubbles: true,
				cancelable: true,
			}),
		);

		const dataTransfer = {
			setData: vi.fn(),
		};
		const dragStartEvent = new Event("dragstart", {
			bubbles: true,
			cancelable: true,
		});
		Object.defineProperty(dragStartEvent, "dataTransfer", {
			value: dataTransfer,
		});
		element.dispatchEvent(dragStartEvent);

		expect(linkContext.onShowFileMenu).toHaveBeenCalledWith(
			expect.any(MouseEvent),
			file,
		);
		expect(dataTransfer.setData).toHaveBeenCalledWith(
			"text/plain",
			`[[${file.path}|${DRAG_RAW_TEXT}]]`,
		);
		expect(dataTransfer.setData).toHaveBeenCalledWith(
			CANVAS_NOTE_DRAG_FORMAT,
			file.path,
		);
	});

	it("evaluates drag data lazily on dragstart", () => {
		const linkContext = createLinkContext();
		const appContext = createAppContext(linkContext);
		const registry = createInteractionRegistry();
		const file = createMockTFile(TARGET_FILE_PATH);
		const descriptor = createSectionDescriptor(file);
		const interactionHandle = createInteractionHandle();
		registry.register(interactionHandle, descriptor);
		const dispatcher = createDelegatedInteractionDispatcher({
			registry,
			linkContext,
			appContext,
		});

		const element = document.createElement("div");
		element.dataset.cclInteractionHandle = interactionHandle;
		const dataTransfer = {
			setData: vi.fn(),
		};

		expect(linkContext.buildWikiLink).not.toHaveBeenCalled();

		attachDispatcher(root, dispatcher);
		root.append(element);
		const dragStartEvent = new Event("dragstart", {
			bubbles: true,
			cancelable: true,
		});
		Object.defineProperty(dragStartEvent, "dataTransfer", {
			value: dataTransfer,
		});
		element.dispatchEvent(dragStartEvent);

		expect(linkContext.buildWikiLink).toHaveBeenCalledTimes(1);
		expect(linkContext.buildWikiLink).toHaveBeenCalledWith(file, DRAG_RAW_TEXT);
		expect(dataTransfer.setData).toHaveBeenCalledWith(
			"text/plain",
			`[[${file.path}|${DRAG_RAW_TEXT}]]`,
		);
	});

	it("resolves interaction targets from composed paths inside a shadow root", () => {
		const linkContext = createLinkContext();
		const appContext = createAppContext(linkContext);
		const registry = createInteractionRegistry();
		const file = createMockTFile(TARGET_FILE_PATH);
		const descriptor = createItemDescriptor(
			{ type: "file", data: file } as CardItem,
			file,
		);
		const interactionHandle = createInteractionHandle();
		registry.register(interactionHandle, descriptor);

		const dispatcher = createDelegatedInteractionDispatcher({
			registry,
			linkContext,
			appContext,
		});
		attachDispatcher(root, dispatcher);

		const shadowRoot = root.attachShadow({ mode: "open" });
		const interactionElement = document.createElement("div");
		interactionElement.dataset.cclInteractionHandle = interactionHandle;
		const child = document.createElement("span");
		interactionElement.append(child);
		shadowRoot.append(interactionElement);

		child.dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true }));

		expect(linkContext.onOpenFile).toHaveBeenCalledTimes(1);
	});

	it("resolves clicks dispatched from a foreign window realm", () => {
		const frame = document.createElement("iframe");
		document.body.append(frame);
		const foreignDocument = frame.contentDocument;
		const foreignWindow = frame.contentWindow;
		expect(foreignDocument).toBeTruthy();
		expect(foreignWindow).toBeTruthy();
		if (!foreignDocument || !foreignWindow) {
			return;
		}

		const linkContext = createLinkContext();
		const appContext = createAppContext(linkContext);
		const registry = createInteractionRegistry();
		const file = createMockTFile(TARGET_FILE_PATH);
		const descriptor = createItemDescriptor(
			{ type: "file", data: file } as CardItem,
			file,
		);
		const interactionHandle = createInteractionHandle();
		registry.register(interactionHandle, descriptor);

		const dispatcher = createDelegatedInteractionDispatcher({
			registry,
			linkContext,
			appContext,
		});
		const foreignRoot = foreignDocument.createElement("div");
		const element = foreignDocument.createElement("div");
		element.dataset.cclInteractionHandle = interactionHandle;
		foreignRoot.append(element);
		foreignDocument.body.append(foreignRoot);
		attachDispatcher(foreignRoot, dispatcher);

		const event = new (foreignWindow as any).MouseEvent("click", {
			bubbles: true,
			composed: true,
		});
		expect(event).not.toBeInstanceOf(Event);
		element.dispatchEvent(event);

		expect(linkContext.onOpenFile).toHaveBeenCalledTimes(1);
		expect(linkContext.onOpenFile).toHaveBeenCalledWith(
			event,
			file,
			expect.anything(),
			expect.anything(),
		);
	});

	it("creates dataTransfer from foreign window for drag", async () => {
		document.body.innerHTML = "";
		const frame = document.createElement("iframe");
		document.body.append(frame);
		const foreignDocument = frame.contentDocument;
		const foreignWindow = frame.contentWindow;

		expect(foreignDocument).toBeTruthy();
		expect(foreignWindow).toBeTruthy();
		if (!foreignDocument || !foreignWindow) {
			return;
		}

		const linkContext = createLinkContext();
		const appContext = createAppContext(linkContext);
		const registry = createInteractionRegistry();
		const file = createMockTFile(FOREIGN_TARGET_FILE_PATH);
		const descriptor = createItemDescriptor(
			{ type: "file", data: file } as CardItem,
			file,
		);
		const interactionHandle = createInteractionHandle();
		registry.register(interactionHandle, descriptor);

		const dispatcher = createDelegatedInteractionDispatcher({
			registry,
			linkContext,
			appContext,
		});
		const foreignRoot = foreignDocument.createElement("div");
		const element = foreignDocument.createElement("div");
		element.dataset.cclInteractionHandle = interactionHandle;
		foreignRoot.append(element);
		foreignDocument.body.append(foreignRoot);
		attachDispatcher(foreignRoot, dispatcher);

		const dataTransfer = {
			setData: vi.fn(),
			setDragImage: vi.fn(),
		};
		const event = new (foreignWindow as any).MouseEvent("dragstart", {
			bubbles: true,
			cancelable: true,
			clientX: 24,
			clientY: 36,
		}) as DragEvent;
		Object.defineProperty(event, "dataTransfer", {
			value: dataTransfer,
		});
		element.dispatchEvent(event);

		const [dragImage] = dataTransfer.setDragImage.mock.calls[0];
		expect((dragImage as HTMLElement).ownerDocument).toBe(foreignDocument);
		expect(
			foreignDocument.body.querySelector(".ccl-native-drag-selection-shim"),
		).toBeTruthy();
	});

	it("creates a lightweight title-only drag image", () => {
		const file = createMockTFile(TARGET_FILE_PATH);
		const descriptor = createItemDescriptor(
			{ type: "file", data: file } as CardItem,
			file,
		);
		const element = document.createElement("div");
		vi.spyOn(element, "getBoundingClientRect").mockReturnValue({
			x: 10,
			y: 20,
			left: 10,
			top: 20,
			right: 290,
			bottom: 220,
			width: 280,
			height: 200,
			toJSON: () => ({}),
		} as DOMRect);

		const title = document.createElement("div");
		title.className = "cosense-card-links__box-title";
		title.textContent = "Visible title";
		const preview = document.createElement("div");
		preview.className = "cosense-card-links__box-preview";
		preview.textContent = "Preview markdown image canvas MathJax";
		element.append(title, preview);
		document.body.append(element);

		const dataTransfer = {
			setDragImage: vi.fn(),
		};
		const event = new MouseEvent("dragstart", {
			bubbles: true,
			cancelable: true,
			clientX: 48,
			clientY: 62,
		}) as DragEvent;
		Object.defineProperty(event, "dataTransfer", {
			value: dataTransfer,
		});

		setLightweightCardDragImage(event, element, descriptor);

		expect(dataTransfer.setDragImage).toHaveBeenCalledTimes(1);
		const [dragImage, offsetX, offsetY] = dataTransfer.setDragImage.mock.calls[0];
		expect(dragImage).toBeInstanceOf(HTMLElement);
		expect((dragImage as HTMLElement).textContent).toBe("Visible title");
		expect((dragImage as HTMLElement).textContent).not.toContain("Preview");
		expect(offsetX).toBe(38);
		expect(offsetY).toBe(40);
	});
});
