import {
	Decoration,
	type DecorationSet,
	EditorView,
	ViewPlugin,
	type ViewUpdate,
} from "@codemirror/view";
import { RangeSetBuilder, StateEffect } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { type SyntaxNode, type NodeType } from "@lezer/common";
import { editorInfoField, TFile } from "obsidian";
import type { PluginHost } from "types/pluginHost";
import { UNRESOLVED_LINK_ATTRIBUTE } from "../../appConstants";
import type { LinkStatusService } from "features/link-decoration/linkStatusService";
import { stripLinkAnchor } from "core/indexing/link-resolution/linkResolution";

const Token = {
	WikiLink: "hmd-internal-link",
	WikiLinkAlias: "link-alias",
	WikiLinkPipe: "link-alias-pipe",
	MarkdownLinkUrl: "url",
	MarkdownLinkText: "string",
};

const unresolvedLinkDecoration = Decoration.mark({
	attributes: {
		[UNRESOLVED_LINK_ATTRIBUTE.NAME]: UNRESOLVED_LINK_ATTRIBUTE.VALUE_SPECIAL,
	},
});

interface DecorableLink {
	path: string;
	ranges: { from: number; to: number }[];
}

// Canvasの型定義（最小限）
interface CanvasNode {
	canvas: {
		view: {
			file: TFile;
		};
	};
	file?: TFile; // ファイルノードの場合
}

export const forceRedrawEffect = StateEffect.define<undefined>();

export function buildLivePreviewPlugin(linkStatusService: LinkStatusService) {
	return ViewPlugin.fromClass(
		class LinkDecoratorPlugin {
			decorations: DecorationSet;
			private readonly tokenClassCache = new WeakMap<NodeType, Set<string>>();

			constructor(view: EditorView) {
				this.decorations = this.buildDecorations(view);
			}

			update(update: ViewUpdate) {
				const needsRedraw =
					update.docChanged ||
					update.viewportChanged ||
					update.transactions.some((tr) =>
						tr.effects.some((e) => e.is(forceRedrawEffect)),
					);

				if (needsRedraw) {
					this.decorations = this.buildDecorations(update.view);
				}
			}

			buildDecorations(view: EditorView): DecorationSet {
				const builder = new RangeSetBuilder<Decoration>();
				const resolutionCache = new Map<string, boolean>();
				const tree = syntaxTree(view.state);

				let sourceFile: TFile | undefined = undefined;

				const editorInfo = view.state.field(editorInfoField) as any;

				if (editorInfo.file instanceof TFile) {
					// 通常のエディタ、またはファイルが割り当てられたCanvasノード
					sourceFile = editorInfo.file;
				} else if (editorInfo.node) {
					// Canvasのテキストノードなどの場合
					const node = editorInfo.node as CanvasNode;
					if (node.file) {
						// ファイルノード
						sourceFile = node.file;
					} else {
						// テキストノードの場合、Canvasファイル自体をソースとみなす
						// 安全にアクセスする
						const canvasView = node.canvas?.view;
						if (canvasView && canvasView.file instanceof TFile) {
							sourceFile = canvasView.file;
						}
					}
				}

				if (!sourceFile) {
					return builder.finish();
				}

				for (const { from, to } of view.visibleRanges) {
					tree.iterate({
						from,
						to,
						enter: (nodeRef) => {
							this.processNode(
								nodeRef.node,
								view,
								sourceFile,
								builder,
								resolutionCache,
							);
						},
					});
				}

				return builder.finish();
			}

			private processNode(
				node: SyntaxNode,
				view: EditorView,
				sourceFile: TFile,
				builder: RangeSetBuilder<Decoration>,
				resolutionCache: Map<string, boolean>,
			) {
				const decorableLink = this.extractDecorableLink(node, view);
				if (!decorableLink) {
					return;
				}

				const lookupPath = linkStatusService.generateLookupPath(
					decorableLink.path,
					sourceFile,
				);

				let shouldDecorate = resolutionCache.get(lookupPath);
				if (shouldDecorate === undefined) {
					// LinkStatusServiceを使って装飾すべきか判断
					shouldDecorate = linkStatusService.shouldDecorateLink(lookupPath);
					resolutionCache.set(lookupPath, shouldDecorate);
				}

				if (shouldDecorate) {
					for (const range of decorableLink.ranges) {
						builder.add(range.from, range.to, unresolvedLinkDecoration);
					}
				}
			}

			private extractDecorableLink(
				node: SyntaxNode,
				view: EditorView,
			): DecorableLink | undefined {
				if (this.isWikiLinkPath(node)) {
					return this.extractWikiLink(node, view);
				}
				if (this.isMarkdownLinkUrl(node)) {
					return this.extractMarkdownLink(node, view);
				}
				return undefined;
			}

			private extractWikiLink(
				node: SyntaxNode,
				view: EditorView,
			): DecorableLink | undefined {
				const linkText = view.state.doc.sliceString(node.from, node.to);
				const linkPath = this.stripAnchor(linkText);
				const ranges = [{ from: node.from, to: node.to }];

				// Check for an alias and add its range if it exists.
				const pipeNode = node.nextSibling;
				if (pipeNode && this.hasTokenClass(pipeNode, Token.WikiLinkPipe)) {
					const aliasNode = pipeNode.nextSibling;
					if (
						aliasNode &&
						this.hasTokenClass(aliasNode, Token.WikiLinkAlias)
					) {
						ranges.push({ from: aliasNode.from, to: aliasNode.to });
					}
				}

				ranges.sort((a, b) => a.from - b.from);

				return { path: linkPath, ranges };
			}

			private extractMarkdownLink(
				node: SyntaxNode,
				view: EditorView,
			): DecorableLink | undefined {
				const urlText = view.state.doc.sliceString(node.from, node.to);
				const linkPath = this.stripAnchor(urlText);
				const ranges = [{ from: node.from, to: node.to }];

				const linkParent = node.parent;
				if (linkParent) {
					linkParent.cursor().iterate((child) => {
						if (
							child.node !== node &&
							this.hasTokenClass(child.node, Token.MarkdownLinkText)
						) {
							ranges.push({ from: child.from, to: child.to });
							return false;
						}
					});
				}

				ranges.sort((a, b) => a.from - b.from);

				return { path: linkPath, ranges };
			}

			private hasTokenClass(
				node: SyntaxNode | undefined,
				className: string,
			): boolean {
				if (!node) return false;

				let tokenClasses = this.tokenClassCache.get(node.type);

				if (!tokenClasses) {
					tokenClasses = new Set(
						node.type.name.split(/[\s._]+/).filter(Boolean),
					);

					this.tokenClassCache.set(node.type, tokenClasses);
				}

				return tokenClasses.has(className);
			}

			/**
			 * ノードがWikiLinkのパス部分であるかを判定します。
			 * メインのリンクテキストから始めるために、エイリアスとパイプを特に除外します。
			 */
			private isWikiLinkPath(node: SyntaxNode): boolean {
				return (
					this.hasTokenClass(node, Token.WikiLink) &&
					!this.hasTokenClass(node, Token.WikiLinkAlias) &&
					!this.hasTokenClass(node, Token.WikiLinkPipe)
				);
			}

			/**
			 * ノードがMarkdownリンクのURL部分であるかを判定します。
			 */
			private isMarkdownLinkUrl(node: SyntaxNode): boolean {
				return this.hasTokenClass(node, Token.MarkdownLinkUrl);
			}

			private stripAnchor(linkText: string): string {
				return stripLinkAnchor(linkText);
			}
		},
		{
			decorations: (v) => v.decorations,
		},
	);
}
