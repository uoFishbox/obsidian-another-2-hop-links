export let enableLogging = false;

export function logger(...args: unknown[]): void {
	if (enableLogging) {
		console.log("[Cosense card links]", ...args);
	}
}

export function setEnableLogging(enabled: boolean): void {
	enableLogging = enabled;
}
