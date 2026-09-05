export type NavigationDirection = "up" | "down" | "left" | "right";

export type SequentialNavigationDirection = "forward" | "backward";

export type VerticalNavigationDirection = Extract<NavigationDirection, "up" | "down">;
