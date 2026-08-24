import type { PluginHost } from "obsidian-integration/pluginHost";
import type { PropertyWidgetStyler } from "obsidian-integration/link-decoration/propertyWidgetStyler";
import { resolveFileByPath } from "obsidian-integration/files/resolveFileByPath";
import {
	getPropertyWidgetRenderSave,
	type PropertyWidgetComponentLike,
} from "obsidian-integration/capabilities/obsidianInternals";
import { applyPatch } from "obsidian-integration/capabilities/applyPatch";
import { getOwnerWindow, isHTMLElementLike } from "shared/ui/dom/realmSafeDom";
const widgetPatchIds = new WeakMap<object, string>();
let nextWidgetPatchId = 1;

export function initPropertyPatcher(
	plugin: PluginHost,
	propertyStyleManager: PropertyWidgetStyler,
): void {
	// ObsidianのUIの準備が整ってからパッチを適用する
	plugin.app.workspace.onLayoutReady(() => {
		patchPropertyWidgets(plugin, propertyStyleManager);
	});
}

function patchPropertyWidgets(
	plugin: PluginHost,
	propertyStyleManager: PropertyWidgetStyler,
): void {
	const widgets = plugin.app.metadataTypeManager.registeredTypeWidgets;

	// 再描画フレームでの再スタイリングが重複しないように、
	// 要素単位でスケジュールを管理するWeakSetを関数スコープに配置
	const scheduledElements = new WeakSet<Element>();

	for (const widget of Object.values(widgets)) {
		const widgetObject = getPropertyWidgetRenderSave(widget);
		if (!widgetObject) {
			continue;
		}
		let patchId = widgetPatchIds.get(widgetObject);
		if (!patchId) {
			patchId = `property-widget:${nextWidgetPatchId++}`;
			widgetPatchIds.set(widgetObject, patchId);
		}

		applyPatch(plugin, {
			id: `${patchId}:render`,
			target: widgetObject,
			method: "render",
			wrap: (oldRender) => {
				return function (
					this: unknown,
					el: unknown,
					value: unknown,
					ctx: unknown,
				) {
					const component = oldRender.call(
						this,
						el,
						value,
						ctx,
					) as PropertyWidgetComponentLike;

					if (!isHTMLElementLike(el) || !isPropertyContext(ctx)) {
						return component;
					}

					const sourceFile = resolveFileByPath(
						plugin.app.vault,
						ctx.sourcePath,
					);
					if (!sourceFile) {
						return component;
					}

					// マネージャーに登録し、初回にスタイリング
					propertyStyleManager.register(el, sourceFile);
					propertyStyleManager.styleElement(el, sourceFile);

					const originalOnunload = component.onunload;
					component.onunload = () => {
						propertyStyleManager.unregister(el);
						if (originalOnunload) {
							originalOnunload.call(component);
						}
					};

					return component;
				};
			},
		});

		if (typeof widgetObject.save !== "function") {
			continue;
		}

		applyPatch(plugin, {
			id: `${patchId}:save`,
			target: widgetObject,
			method: "save",
			wrap: (oldSave) => {
				return function (this: unknown, ...args: unknown[]) {
					const result = oldSave.call(this, ...args);

					// `this` はウィジェットインスタンスを指す
					const widgetInstance = asWidgetInstance(this);
					const el = widgetInstance?.el;
					const sourcePath = widgetInstance?.sourcePath;

					if (!el || !sourcePath) return result;

					const sourceFile = resolveFileByPath(plugin.app.vault, sourcePath);
					if (!sourceFile) return result;

					if (!scheduledElements.has(el)) {
						scheduledElements.add(el);
						const ownerWindow = getOwnerWindow(el);
						const schedule =
							typeof ownerWindow.requestAnimationFrame === "function"
								? ownerWindow.requestAnimationFrame.bind(ownerWindow)
								: (cb: FrameRequestCallback) =>
										ownerWindow.setTimeout(() => cb(0), 0);

						schedule(() => {
							scheduledElements.delete(el);
							if (el.isConnected) {
								propertyStyleManager.styleElement(el, sourceFile);
							}
						});
					}

					return result;
				};
			},
		});
	}
}

function isPropertyContext(value: unknown): value is { sourcePath: string } {
	return (
		!!value &&
		typeof value === "object" &&
		typeof (value as { sourcePath?: unknown }).sourcePath === "string"
	);
}

function asWidgetInstance(
	value: unknown,
): { el?: HTMLElement; sourcePath?: string } | null {
	if (!value || typeof value !== "object") {
		return null;
	}

	const candidate = value as { el?: unknown; sourcePath?: unknown };
	return {
		el: isHTMLElementLike(candidate.el) ? candidate.el : undefined,
		sourcePath:
			typeof candidate.sourcePath === "string" ? candidate.sourcePath : undefined,
	};
}
