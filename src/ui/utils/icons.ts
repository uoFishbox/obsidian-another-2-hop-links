/**
 * Structured SVG icon definitions for inline rendering.
 *
 * All icons in this module replicate lucide-svelte icons at 24×24 viewBox
 * with the same default stroke attributes (stroke="currentColor",
 * stroke-width="2", stroke-linecap/linejoin="round").
 *
 * Icons are stored as structured element trees (`ICONS`) so they can be
 * rendered through real Svelte SVG elements (see `Icon.svelte`) without
 * `{@html}`. Rendering raw HTML strings forces the browser to parse HTML
 * on every cell creation/swap, which is a measurable cost on the no-preview
 * hot path (e.g. `LinkItem.svelte`).
 */

export const svgAttrs = {
	xmlns: "http://www.w3.org/2000/svg",
	viewBox: "0 0 24 24",
	fill: "none",
	"stroke-width": "2",
	"stroke-linecap": "round",
	"stroke-linejoin": "round",
} as const;

/**
 * Discriminated union of the SVG element shapes used by the icons below.
 *
 * Attribute values are kept as strings to match the original lucide markup
 * verbatim. Only the attributes actually present on each element are stored;
 * omitted optional attributes are not rendered.
 */
export type SvgElement =
	| { tag: "path"; d: string }
	| { tag: "circle"; cx: string; cy: string; r: string; fill?: string }
	| {
			tag: "rect";
			width: string;
			height: string;
			x: string;
			y: string;
			rx?: string;
			ry?: string;
	  }
	| { tag: "line"; x1: string; y1: string; x2: string; y2: string };

const ICONS_DATA = {
	Ellipsis: [
		{ tag: "circle", cx: "12", cy: "12", r: "1" },
		{ tag: "circle", cx: "19", cy: "12", r: "1" },
		{ tag: "circle", cx: "5", cy: "12", r: "1" },
	],
	Link: [
		{
			tag: "path",
			d: "M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71",
		},
		{
			tag: "path",
			d: "M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71",
		},
	],
	Unlink: [
		{
			tag: "path",
			d: "m18.84 12.25 1.72-1.71h-.02a5.004 5.004 0 0 0-.12-7.07 5.006 5.006 0 0 0-6.95 0l-1.72 1.71",
		},
		{
			tag: "path",
			d: "m5.17 11.75-1.71 1.71a5.004 5.004 0 0 0 .12 7.07 5.006 5.006 0 0 0 6.95 0l1.71-1.71",
		},
		{ tag: "line", x1: "8", x2: "8", y1: "2", y2: "5" },
		{ tag: "line", x1: "2", x2: "5", y1: "8", y2: "8" },
		{ tag: "line", x1: "16", x2: "16", y1: "19", y2: "22" },
		{ tag: "line", x1: "19", x2: "22", y1: "16", y2: "16" },
	],
	Tag: [
		{
			tag: "path",
			d: "M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z",
		},
		{ tag: "circle", cx: "7.5", cy: "7.5", r: ".5", fill: "currentColor" },
	],
	Trash2: [
		{ tag: "path", d: "M3 6h18" },
		{
			tag: "path",
			d: "M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6",
		},
		{
			tag: "path",
			d: "M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2",
		},
		{ tag: "line", x1: "10", x2: "10", y1: "11", y2: "17" },
		{ tag: "line", x1: "14", x2: "14", y1: "11", y2: "17" },
	],
	X: [
		{ tag: "path", d: "M18 6 6 18" },
		{ tag: "path", d: "m6 6 12 12" },
	],
	Bookmark: [
		{
			tag: "path",
			d: "m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z",
		},
	],
	File: [
		{
			tag: "path",
			d: "M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z",
		},
		{ tag: "path", d: "M14 2v4a2 2 0 0 0 2 2h4" },
	],
	FileText: [
		{
			tag: "path",
			d: "M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z",
		},
		{ tag: "path", d: "M14 2v4a2 2 0 0 0 2 2h4" },
		{ tag: "path", d: "M10 9H8" },
		{ tag: "path", d: "M16 13H8" },
		{ tag: "path", d: "M16 17H8" },
	],
	FileAudio: [
		{
			tag: "path",
			d: "M17.5 22h.5a2 2 0 0 0 2-2V7l-5-5H6a2 2 0 0 0-2 2v3",
		},
		{ tag: "path", d: "M14 2v4a2 2 0 0 0 2 2h4" },
		{
			tag: "path",
			d: "M2 19a2 2 0 1 1 4 0v1a2 2 0 1 1-4 0v-4a6 6 0 0 1 12 0v4a2 2 0 1 1-4 0v-1a2 2 0 1 1 4 0",
		},
	],
	Image: [
		{ tag: "rect", width: "18", height: "18", x: "3", y: "3", rx: "2", ry: "2" },
		{ tag: "circle", cx: "9", cy: "9", r: "2" },
		{
			tag: "path",
			d: "m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21",
		},
	],
	LayoutDashboard: [
		{ tag: "rect", width: "7", height: "9", x: "3", y: "3", rx: "1" },
		{ tag: "rect", width: "7", height: "5", x: "14", y: "3", rx: "1" },
		{ tag: "rect", width: "7", height: "9", x: "14", y: "12", rx: "1" },
		{ tag: "rect", width: "7", height: "5", x: "3", y: "16", rx: "1" },
	],
	LayoutList: [
		{ tag: "rect", width: "7", height: "7", x: "3", y: "3", rx: "1" },
		{ tag: "rect", width: "7", height: "7", x: "3", y: "14", rx: "1" },
		{ tag: "path", d: "M14 4h7" },
		{ tag: "path", d: "M14 15h7" },
	],
} as const satisfies Record<string, readonly SvgElement[]>;

/**
 * Re-exports the icon table with elements widened to `SvgElement` so optional
 * attributes (e.g. `fill` on a circle, `ry` on a rect) are uniformly
 * accessible while keeping the discriminated `tag` literal for narrowing.
 * Keys are preserved as the `IconName` union via a mapped type.
 */
export const ICONS: {
	readonly [K in keyof typeof ICONS_DATA]: readonly SvgElement[];
} = ICONS_DATA;

export type IconName = keyof typeof ICONS;
