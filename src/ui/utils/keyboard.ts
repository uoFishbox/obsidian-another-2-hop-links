export const handleKeyboardActivation = (
	event: KeyboardEvent,
	callback: (event: KeyboardEvent) => void
): void => {
	if (event.key === "Enter" || event.key === " ") {
		event.preventDefault();
		callback(event);
	}
};




