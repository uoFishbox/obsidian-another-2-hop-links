import { App, TFile, FileView } from "obsidian";
import { resolveFileByPath } from "infrastructure/utils/vaultUtils";
import { CANVAS_NOTE_DRAG_FORMAT } from "../../appConstants";
import type { CanvasView, CanvasViewCanvas } from "obsidian-typings";
import { ObsidianInternalFacade } from "infrastructure/capabilities/ObsidianInternalFacade";

export class CanvasDropManager {
	private registeredListeners = new Map<HTMLElement, () => void>();

	constructor(private app: App) {}

	public registerCanvasDropHandler(registerEvent: (callback: any) => void): void {
		this.syncCanvasDropHandlers();

		registerEvent(
			this.app.workspace.on("active-leaf-change", (leaf) => {
				this.pruneDisconnectedCanvasHandlers();
				if (leaf?.view.getViewType() === "canvas") {
					this.setupCanvasDropHandlers(leaf.view as CanvasView);
				}
			}),
		);
		registerEvent(
			this.app.workspace.on("layout-change", () => {
				this.syncCanvasDropHandlers();
			}),
		);
	}

	private syncCanvasDropHandlers(): void {
		this.pruneDisconnectedCanvasHandlers();
		this.app.workspace.iterateAllLeaves((leaf) => {
			this.setupCanvasDropHandlers(leaf.view as FileView);
		});
	}

	private setupCanvasDropHandlers(view: FileView): void {
		if (view.getViewType() !== "canvas") {
			return;
		}
		const canvasView = view as CanvasView;
		const canvas = canvasView.canvas;
		const canvasEl = canvas.wrapperEl as HTMLElement;

		if (!canvasEl.isConnected) {
			return;
		}

		// 既に登録済みの場合はスキップ
		if (this.registeredListeners.has(canvasEl)) {
			return;
		}

		const handleDragOver = this.createDragOverHandler();
		const handleDrop = this.createDropHandler(canvas);

		canvasEl.addEventListener("dragover", handleDragOver, {
			capture: true,
		});
		canvasEl.addEventListener("drop", handleDrop, {
			capture: true,
		});

		const removeListeners = () => {
			canvasEl.removeEventListener("dragover", handleDragOver, {
				capture: true,
			});
			canvasEl.removeEventListener("drop", handleDrop, {
				capture: true,
			});
			this.registeredListeners.delete(canvasEl);
		};

		this.registeredListeners.set(canvasEl, removeListeners);
	}

	private pruneDisconnectedCanvasHandlers(): void {
		for (const [canvasEl, removeListeners] of this.registeredListeners) {
			if (!canvasEl.isConnected) {
				removeListeners();
			}
		}
	}

	private createDragOverHandler(): (event: DragEvent) => void {
		return (event: DragEvent) => {
			if (event.dataTransfer?.types.includes(CANVAS_NOTE_DRAG_FORMAT)) {
				event.preventDefault();
				event.stopPropagation();
				event.dataTransfer.dropEffect = "copy";
			}
		};
	}

	private createDropHandler(canvas: CanvasViewCanvas): (event: DragEvent) => void {
		return async (event: DragEvent) => {
			await this.handleDrop(canvas, event);
		};
	}

	private async handleDrop(
		canvas: CanvasViewCanvas,
		event: DragEvent,
	): Promise<void> {
		if (!event.dataTransfer?.types.includes(CANVAS_NOTE_DRAG_FORMAT)) {
			return;
		}

		event.preventDefault();
		event.stopPropagation();

		const filePath = event.dataTransfer.getData(CANVAS_NOTE_DRAG_FORMAT);
		if (!filePath) return;

		const file = resolveFileByPath(this.app.vault, filePath);
		if (!file) return;

		const pos = canvas.posFromEvt(event);

		const capability = new ObsidianInternalFacade(this.app).getCanvasCreateFileNode(
			canvas,
		);
		if (!capability.ok) {
			return;
		}

		capability.value.createFileNode({
			pos: pos,
			file: file,
			position: "center",
		});

		canvas.pushHistory(canvas.getData());
	}

	public destroy(): void {
		for (const removeListeners of this.registeredListeners.values()) {
			removeListeners();
		}
		this.registeredListeners.clear();
	}
}
