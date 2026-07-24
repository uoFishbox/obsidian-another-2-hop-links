export const CARD_RENDER_SHADOW_CSS = String.raw`
.cosense-card-links__box-preview.is-stale {
	visibility: hidden;
}

:host {
	display: block;
}


.ccl-search-highlight {
    color: var(--text-normal);
    background-color: var(--text-highlight-bg)
}

.view-plan-virtual-list-content {
	position: relative;
	width: 100%;
	contain: content;
	overflow-anchor: none;
}

.cosense-card-links__virtual-grid-content {
	position: relative;
	width: 100%;
	contain: layout;
}

.view-plan-virtual-list-cell {
	position: absolute;
	top: 0;
	left: 0;
	box-sizing: border-box;
	min-width: 0;
	width: var(--ccl-cell-width);
	height: var(--ccl-box-height);
	contain: layout paint;
}

.view-plan-flow-cell {
	position: relative;
	top: auto;
	left: auto;
	flex: 0 0 var(--ccl-cell-width);
}

.view-plan-virtual-list-cell,
.cosense-card-links__virtual-grid-cell {
	box-sizing: border-box;
	min-width: 0;
	width: var(--ccl-cell-width);
	flex: 0 0 var(--ccl-cell-width);
	height: var(--ccl-box-height);
}

.view-plan-virtual-list-cell {
    contain: layout paint;
}

.cosense-card-links__virtual-grid-cell {
    contain: layout;
}

.view-plan-flow-row {
	position: absolute;
	inset-inline: 0;
	top: 0;
	margin-bottom: 0;
	width: 100%;
	height: var(--ccl-box-height);
	display: flex;
	gap: var(--ccl-box-gap);
	contain: layout paint;
}

.cosense-card-links__virtual-grid-row {
	position: absolute;
	inset-inline: 0;
	top: 0;
	margin-bottom: 0;
	width: 100%;
	height: var(--ccl-box-height);
	display: flex;
	gap: var(--ccl-box-gap);
	contain: layout;
}


.cosense-card-links__box {
	position: relative;
	box-sizing: border-box;
	width: 100%;
	height: var(--ccl-box-height);
	min-width: 0;
	min-height: var(--ccl-box-height);
	display: flex;
	flex-direction: column;
	border-radius: var(--ccl-box-radius);
	background-color: var(--ccl-bg-box);
	border: 1px solid var(--ccl-bg-box-top);
	cursor: pointer;
	overflow: visible;
	word-break: break-word;
	touch-action: manipulation;
}

.twohop-card-shell.is-skeleton {
	pointer-events: none;
}

.twohop-card-shell.is-skeleton .cosense-card-links__box-title-wrapper::before {
	content: "";
	display: block;
	width: 62%;
	height: 0.8em;
	border-radius: 999px;
	background: var(--background-modifier-border);
}

.twohop-card-shell.is-skeleton.has-shell-title .cosense-card-links__box-title-wrapper::before {
	display: none;
}

.twohop-card-shell.is-skeleton.has-shell-title .cosense-card-links__box-title {
	opacity: 0.78;
}

@media (hover: hover) {
	.cosense-card-links__box:not(.cosense-card-links__connected-links-header)[data-ccl-hovered="true"] {
		border-color: var(--background-modifier-border-hover);
	}
}

.cosense-card-links__connected-links-header,
.cosense-card-links__twohop-header,
.cosense-card-links__properties-header,
.cosense-card-links__new-links-header,
.cosense-card-links__load-more-button {
	width: 100%;
	height: var(--ccl-box-height);
	min-height: var(--ccl-box-height);
	border-radius: var(--radius-m);
}

.cosense-card-links__connected-links-header,
.cosense-card-links__twohop-header,
.cosense-card-links__properties-header,
.cosense-card-links__new-links-header {
	display: flex;
	align-items: center;
	justify-content: center;
	flex-direction: column;
	gap: 14px;
	color: var(--ccl-box-text-content);
	font-size: 1em;
}

.cosense-card-links__connected-links-header {
	color: var(--color-base-20);
	background-color: var(--color-accent);
	border: none;
	cursor: default;
}

.cosense-card-links__twohop-header {
	display: flex;
	align-items: center;
	justify-content: center;
	flex-direction: column;
	gap: 14px;
	color: var(--ccl-box-text-content);
	font-size: 1em;
	background-color: var(--ccl-bg-header-twohop);
	padding: var(--ccl-box-padding);
}

.cosense-card-links__twohop-header.cosense-card-links__box--missing,
.cosense-card-links__box--missing,
.cosense-card-links__box[data-ccl-resolution="missing"] {
	border: 1px dashed var(--color-base-40);
}

@media (hover: hover) {
	.cosense-card-links__twohop-header.cosense-card-links__box--missing:hover,
	.cosense-card-links__box.cosense-card-links__box--missing[data-ccl-hovered="true"],
	.cosense-card-links__box[data-ccl-resolution="missing"][data-ccl-hovered="true"] {
		border-color: var(--background-modifier-border-hover);
	}
}

.cosense-card-links__title-container {
	display: flex;
	flex-direction: column;
	min-height: 0;
	align-items: center;
	justify-content: center;
	width: 100%;
	gap: 10px;
	font-size: 0.95em;
	line-height: 1.1;
	word-break: break-word;
}

.cosense-card-links__header-title {
	display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 3;
}

.cosense-card-links__box-title-wrapper {
	padding: var(--ccl-box-padding);
	display: block;
	flex: 0 0 auto;
	flex-direction: column;
	align-items: flex-start;
	position: relative;
	z-index: 1;
	pointer-events: none;
}

.cosense-card-links__box-title {
	color: var(--ccl-title-box);
	font-weight: 600;
	font-size: 0.85em;
	display: -webkit-box;
	-webkit-box-orient: vertical;
	-webkit-line-clamp: 3;
	line-clamp: 3;
	overflow: clip;
	line-height: 1.3;
}

.cosense-card-links__file-icon {
	display: inline-flex;
	align-items: center;
	vertical-align: middle;
	margin-right: 4px;
	color: var(--text-muted);
}

.cosense-card-links__file-icon svg {
	width: 1em;
	height: 1em;
}

.cosense-card-links__box-extension {
	font-size: 9px;
	font-weight: 600;
	color: var(--nav-tag-color);
	text-transform: uppercase;
}


.cosense-card-links__box[data-ccl-resolution="missing"] .cosense-card-links__box-title,
.cosense-card-links__box[data-ccl-section-variant="new-links"] .cosense-card-links__box-title {
	color: var(--color-base-50);
}

.cosense-card-links__box .cosense-card-links__connected-links-header {
	background-color: var(--ccl-bg-box) !important;
}

.cosense-card-links__connected-links-header[data-ccl-section-variant="new-links"] {
	background-color: var(--ccl-single-backlink-unresolved) !important;
}

.cosense-card-links__box-bookmark-bg {
	position: absolute;
	top: -4px;
	right: 2px;
	color: var(--icon-color-active);
	pointer-events: none;
	z-index: 0;
}

.preview-mount-slot {
	contain: layout style;
	width: auto;
	position: relative;
	display: flex;
	flex: 1 1 auto;
	flex-direction: column;
	min-height: inherit;
	height: 100%;
	overflow: visible;
}


.preview-mount-slot,
.cosense-card-links__box-preview {
	pointer-events: none !important;
}

.cosense-card-links__box-preview a,
.cosense-card-links__box-preview img,
.cosense-card-links__box-preview [draggable="true"] {
	-webkit-user-drag: none !important;
	user-drag: none !important;
}

.cosense-card-links__box-preview--text {
	padding: 0px var(--ccl-box-padding) 0px var(--ccl-box-padding);
} 

.cosense-card-links__box-preview--image {
	padding: 0px calc(var(--ccl-box-padding) / 2) 0px calc(var(--ccl-box-padding) / 2);
}

.lazy-placeholder {
	width: 100%;
	height: 100%;
	flex: 1 1 auto;
	min-height: inherit;
	background: transparent;
}

.cosense-card-links__box-preview {
	contain: layout;
	font-size: var(--ccl-preview-font-size);
	color: var(--ccl-box-text-content);
	white-space: pre-line;
	user-select: none;
	flex: 1 1 auto;
	min-height: 1em;
	min-width: 0;
	overflow: clip;
}

.cosense-card-links__box-preview.hidden {
	display: none;
}

.cosense-card-links__box-preview .cosense-card-links__wikilink,
.cosense-card-links__box-preview .cosense-card-links__external-link {
	pointer-events: none;
}

.cosense-card-links__box-preview .canvas-minimap {
	padding: 0;
	max-height: 120px;
}

.cosense-card-links__box-preview img {
	width: 100%;
	height: auto;
	object-fit: cover;
	border-radius: var(--radius-s);
	-webkit-user-drag: none;
}

.cosense-card-links__box-preview .embed-title {
	display: none;
}

.cosense-card-links__box-preview mjx-container[jax="CHTML"][display="true"] {
	margin: 0;
}

.cosense-card-links__box-preview mjx-math[display="true"] {
	font-size: 85%;
}

.cosense-card-links__wikilink,
.cosense-card-links__external-link {
	color: var(--link-color);
}

.cosense-card-links__external-link {
	text-decoration: underline;
}



.cosense-card-links__box[data-ccl-kb-row-selected="1"] {
	position: relative;
	border-color: var(--interactive-accent);
	box-shadow: 0 0 0 1px color-mix(in srgb, var(--interactive-accent) 55%, transparent);
}

.cosense-card-links__box[data-ccl-kb-row-selected="1"]::before {
	content: "";
	position: absolute;
	inset: 0;
	background: linear-gradient(180deg, color-mix(in srgb, var(--interactive-accent) 10%, transparent), transparent 55%);
	pointer-events: none;
}

.cosense-card-links__box[data-ccl-kb-hint]::after {
	content: attr(data-ccl-kb-hint);
	position: absolute;
	top: 8px;
	right: 8px;
	min-width: 1.6em;
	padding: 2px 6px;
	border-radius: 999px;
	background: color-mix(in srgb, var(--interactive-accent) 92%, black 8%);
	color: var(--text-on-accent);
	font-size: 0.75em;
	font-weight: 700;
	line-height: 1.4;
	text-align: center;
	text-transform: lowercase;
	letter-spacing: 0.02em;
	pointer-events: none;
	z-index: 1;
}

.cosense-card-links__load-more-button {
	display: flex;
	justify-content: center;
	align-items: center;
	background-color: transparent;
	border: none;
	color: var(--color-base-50);
	cursor: pointer;
	padding: 4px 0;
	width: 100%;
	height: 100%;
}

.cosense-card-links__load-more-button.cosense-card-links__box {
	border: none;
	box-shadow: none;
}

.cosense-card-links__load-more-button > .cosense-card-links__box-title-wrapper {
	display: contents;
}

.twohop-keyed-surface {
	contain: layout paint style;
}

.twohop-keyed-row {
	contain: layout paint;
}

@media (hover: hover) {
	.cosense-card-links__load-more-button.cosense-card-links__box:hover {
		color: var(--color-base-60);
		transition: color 0.2s ease;
	}
}

.cosense-card-links__box.is-attachment .cosense-card-links__box-preview {
	margin-left: calc(var(--ccl-box-padding) * -1);
	margin-right: calc(var(--ccl-box-padding) * -1);
	margin-bottom: calc(var(--ccl-box-padding) * -1);
	width: calc(100% + (var(--ccl-box-padding) * 2));
	padding-top: 0;
	margin-top: 8px;
}

.cosense-card-links__box.is-attachment .cosense-card-links__box-preview img {
	border-radius: 0;
	display: block;
	width: 100%;
	height: auto;
	object-fit: cover;
}

.mod-canvas-color-1 {
  --canvas-color: var(--canvas-color-1);
}
.mod-canvas-color-2 {
  --canvas-color: var(--canvas-color-2);
}
.mod-canvas-color-3 {
  --canvas-color: var(--canvas-color-3);
}
.mod-canvas-color-4 {
  --canvas-color: var(--canvas-color-4);
}
.mod-canvas-color-5 {
  --canvas-color: var(--canvas-color-5);
}
.mod-canvas-color-6 {
  --canvas-color: var(--canvas-color-6);
}

.canvas-minimap {
  width: 100%;
  height: 100%;
  padding: var(--size-4-1);
}
.inline-embed > .canvas-minimap {
  max-height: var(--embed-canvas-max-height);
}
.canvas-minimap rect {
  stroke-width: 5px;
  stroke: var(--background-modifier-border);
  fill: var(--background-modifier-border);
  fill-opacity: 0.65;
}
.canvas-minimap rect.is-themed {
  stroke: rgb(var(--canvas-color));
  fill: rgb(var(--canvas-color));
  fill-opacity: 0.5;
}
.canvas-minimap path {
  stroke: #c0c0c0;
  fill: none;
}
.canvas-minimap path.is-themed {
  stroke: rgb(var(--canvas-color));
}
`;
