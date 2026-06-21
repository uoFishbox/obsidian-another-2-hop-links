import { PLUGIN_NAME } from "../appConstants";

function logError(message: string, error: unknown, context?: string): void {
	const contextStr = context ? ` [${context}]` : "";
	console.error(`${PLUGIN_NAME}: ${message}${contextStr}`, error);
}

export function handleError(error: unknown, context?: string): void {
	logError("An error occurred", error, context);
}

export function handleAsyncError(error: unknown, context?: string): void {
	logError("Async operation failed", error, context);
}

export function handleComponentError(
	error: unknown,
	componentName?: string,
): void {
	const component = componentName ? ` in ${componentName}` : "";
	logError(`Component error${component}`, error);
}

export function handleMountError(error: unknown, filePath?: string): void {
	const file = filePath ? ` for file: ${filePath}` : "";
	logError(`Failed to mount component${file}`, error);
}

export function handleUnmountError(error: unknown, filePath?: string): void {
	const file = filePath ? ` for file: ${filePath}` : "";
	logError(`Failed to unmount component${file}`, error);
}

export function handleFileOperationError(
	error: unknown,
	operation: string,
	filePath?: string,
): void {
	const file = filePath ? ` on file: ${filePath}` : "";
	logError(`File operation failed: ${operation}${file}`, error);
}

export function handleLinkResolutionError(
	error: unknown,
	linkPath?: string,
): void {
	const link = linkPath ? ` for link: ${linkPath}` : "";
	logError(`Link resolution failed${link}`, error);
}
