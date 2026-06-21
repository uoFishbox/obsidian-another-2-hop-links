import type { PluginHost } from "types/pluginHost";
import type { StylingService } from "features/link-decoration/stylingService";
import type { PropertyWidgetStyler } from "features/link-decoration/propertyWidgetStyler";
import { resolveFileByPath } from "infrastructure/utils/vaultUtils";
import { enableLogging, logger } from "utils/logger";
import {
	ObsidianInternalFacade,
	type PropertyWidgetComponentLike,
	type PropertyWidgetLike,
} from "infrastructure/capabilities/ObsidianInternalFacade";
import type { PatchRegistry } from "infrastructure/capabilities/PatchRegistry";
const widgetPatchIds = new WeakMap<object, string>();
let nextWidgetPatchId = 1;

export function initPropertyPatcher(
	plugin: PluginHost,
	patchRegistry: PatchRegistry,
	stylingService: StylingService,
	propertyStyleManager: PropertyWidgetStyler,
): void {
	// ObsidianのUIの準備が整ってからパッチを適用する
	plugin.app.workspace.onLayoutReady(() => {
		patchPropertyWidgets(
			plugin,
			patchRegistry,
			stylingService,
			propertyStyleManager,
		);
	});
}

function patchPropertyWidgets(
	plugin: PluginHost,
	patchRegistry: PatchRegistry,
	stylingService: StylingService,
	propertyStyleManager: PropertyWidgetStyler,
): void {
	const widgets = plugin.app.metadataTypeManager.registeredTypeWidgets;

	if (enableLogging)
		logger(
			"[PropertyPatcher] Patching built-in property widgets for styling...",
		);

	// 再描画フレームでの再スタイリングが重複しないように、
	// 要素単位でスケジュールを管理するWeakSetを関数スコープに配置
	const scheduledElements = new WeakSet<Element>();

	for (const widget of Object.values(widgets)) {
		const capability = new ObsidianInternalFacade(
			plugin.app,
		).getPropertyWidgetRenderSave(widget);
		if (!capability.ok) {
			if (enableLogging)
				logger(
					`[PropertyPatcher] Skipped widget: ${capability.reason}.`,
				);
			continue;
		}

		const widgetObject = capability.value;
		let patchId = widgetPatchIds.get(widgetObject);
		if (!patchId) {
			patchId = `property-widget:${nextWidgetPatchId++}`;
			widgetPatchIds.set(widgetObject, patchId);
		}

		patchRegistry.apply(plugin, {
			id: `${patchId}:render`,
			target: widgetObject,
			method: "render",
			risk: capability.risk,
			enabled: true,
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

					// 描画された要素内のリンクを装飾する
					if (
						!(el instanceof HTMLElement) ||
						!isPropertyContext(ctx)
					) {
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

					// コンポーネント破棄時に登録解除
					const originalOnunload = component.onunload;
					component.onunload = () => {
						propertyStyleManager.unregister(el);
						if (originalOnunload) {
							originalOnunload.call(component);
						}
					};

					// 3. 元のrenderメソッドの返り値をそのまま返す
					return component;
				};
			},
		});

		if (typeof widgetObject.save !== "function") {
			continue;
		}

		patchRegistry.apply(plugin, {
			id: `${patchId}:save`,
			target: widgetObject,
			method: "save",
			risk: capability.risk,
			enabled: true,
			wrap: (oldSave) => {
				return function (this: unknown, ...args: unknown[]) {
					const result = oldSave.call(this, ...args);

					// `this` はウィジェットインスタンスを指す
					const widgetInstance = asWidgetInstance(this);
					const el = widgetInstance?.el;
					const sourcePath = widgetInstance?.sourcePath;

					if (!el || !sourcePath) return result;

					const sourceFile = resolveFileByPath(
						plugin.app.vault,
						sourcePath,
					);
					if (!sourceFile) return result;

					// 値が変更された後、レンダリングサイクルの完了を待って再スタイリング
					// requestAnimationFrameが利用可能ならそれを使い、なければsetTimeout(0)でフォールバック
					if (!scheduledElements.has(el)) {
						scheduledElements.add(el);
						const schedule =
							typeof window.requestAnimationFrame === "function"
								? window.requestAnimationFrame
								: (cb: FrameRequestCallback) =>
										window.setTimeout(() => cb(0), 0);

						schedule(() => {
							scheduledElements.delete(el);
							if (el.isConnected) {
								propertyStyleManager.styleElement(
									el,
									sourceFile,
								);
							}
						});
					}

					return result;
				};
			},
		});
	}

	if (enableLogging)
		logger(
			"[PropertyPatcher] Finished patching property widgets for styling.",
		);
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
		el: candidate.el instanceof HTMLElement ? candidate.el : undefined,
		sourcePath:
			typeof candidate.sourcePath === "string"
				? candidate.sourcePath
				: undefined,
	};
}
