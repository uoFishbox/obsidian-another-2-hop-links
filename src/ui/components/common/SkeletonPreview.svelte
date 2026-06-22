<div class="skeleton-loader"></div>

<style>
	/* Render 5 stacked bars with a single element using multiple backgrounds.
	   Bars: 5px tall, 9px gap, last bar 70% width. Total height = 5*5 + 4*9 = 61px. */
	.skeleton-loader {
		padding-top: 10px;
		padding-left: var(--ccl-box-padding);
		padding-right: var(--ccl-box-padding);
		height: 61px;
		background-image:
			linear-gradient(var(--color-base-20), var(--color-base-20)),
			linear-gradient(var(--color-base-20), var(--color-base-20)),
			linear-gradient(var(--color-base-20), var(--color-base-20)),
			linear-gradient(var(--color-base-20), var(--color-base-20)),
			linear-gradient(var(--color-base-20), var(--color-base-20));
		background-size:
			100% 5px,
			100% 5px,
			100% 5px,
			100% 5px,
			70% 5px;
		background-position:
			0 0,
			0 14px,
			0 28px,
			0 42px,
			0 56px;
		background-repeat: no-repeat;
		border-radius: 2px;
	}
</style>
