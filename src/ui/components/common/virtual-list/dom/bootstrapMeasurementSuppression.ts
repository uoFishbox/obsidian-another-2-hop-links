export interface BootstrapMeasurementSuppression {
	cancel(): void;
	suppressForBootstrap(): void;
	scheduleObservedLayoutMeasurement(): void;
}

export function createBootstrapMeasurementSuppression(
	scheduleLayoutMeasurement: () => void,
	getWindow: () => Window | null = () =>
		typeof window === "undefined" ? null : window,
): BootstrapMeasurementSuppression {
	let suppressObservedLayoutMeasurement = false;
	let observedLayoutSuppressionHandle: number | null = null;

	const release = () => {
		suppressObservedLayoutMeasurement = false;
		observedLayoutSuppressionHandle = null;
	};

	const cancel = () => {
		if (observedLayoutSuppressionHandle === null) {
			return;
		}

		const ownerWindow = getWindow();
		if (ownerWindow) {
			if (typeof ownerWindow.cancelAnimationFrame === "function") {
				ownerWindow.cancelAnimationFrame(observedLayoutSuppressionHandle);
			} else {
				ownerWindow.clearTimeout(observedLayoutSuppressionHandle);
			}
		}
		release();
	};

	return {
		cancel,
		suppressForBootstrap() {
			const ownerWindow = getWindow();
			if (!ownerWindow) {
				return;
			}

			cancel();
			suppressObservedLayoutMeasurement = true;
			if (typeof ownerWindow.requestAnimationFrame === "function") {
				observedLayoutSuppressionHandle = ownerWindow.requestAnimationFrame(
					() => {
						release();
					},
				);
				return;
			}

			observedLayoutSuppressionHandle = ownerWindow.setTimeout(() => {
				release();
			}, 0);
		},
		scheduleObservedLayoutMeasurement() {
			if (suppressObservedLayoutMeasurement) {
				return;
			}

			scheduleLayoutMeasurement();
		},
	};
}
