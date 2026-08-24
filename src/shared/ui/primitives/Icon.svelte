<script lang="ts" module>
	import { svgAttrs, ICONS, type IconName } from "shared/ui/icons/iconRegistry";
</script>

<script lang="ts">
	/**
	 * Renders an inline SVG icon from the structured {@link ICONS} table.
	 *
	 * Elements are emitted as real Svelte SVG nodes (path/circle/rect/line)
	 * rather than via `{@html}`, so cell creation/replacement never triggers
	 * HTML parsing. Stroke-based icons (the default) use
	 * `fill="none"` + `stroke="currentColor"`; filled icons such as the
	 * bookmark pass `fill="currentColor"` and `stroke="none"`.
	 */
	interface Props {
		name: IconName;
		width?: number | string;
		height?: number | string;
		stroke?: string;
		fill?: string;
		class?: string;
	}

	let {
		name,
		width = 16,
		height = 16,
		// Stroke-based icons are the norm; override to "none" for filled icons.
		stroke = "currentColor",
		// svgAttrs already sets fill="none"; keep it concrete so an undefined
		// spread override never strips the default and leaves icons black-filled.
		fill = "none",
		class: className,
	}: Props = $props();

	const elements = $derived(ICONS[name]);
</script>

<svg
	{...svgAttrs}
	{width}
	{height}
	{stroke}
	{fill}
	class={className}
	aria-hidden="true"
>
	{#each elements as el, i (`${el.tag}-${i}`)}
		{#if el.tag === "path"}
			<path d={el.d} />
		{:else if el.tag === "circle"}
			<circle cx={el.cx} cy={el.cy} r={el.r} fill={el.fill} />
		{:else if el.tag === "rect"}
			<rect
				width={el.width}
				height={el.height}
				x={el.x}
				y={el.y}
				rx={el.rx}
				ry={el.ry}
			/>
		{:else if el.tag === "line"}
			<line x1={el.x1} y1={el.y1} x2={el.x2} y2={el.y2} />
		{/if}
	{/each}
</svg>
