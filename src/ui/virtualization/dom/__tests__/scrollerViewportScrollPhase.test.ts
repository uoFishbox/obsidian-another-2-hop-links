import { describe, expect, it } from "vitest";
import {
	markScrollerViewportDependencyRefreshAfterScroll,
	markScrollerViewportLayoutMeasurementAfterScroll,
	markScrollerViewportScrollObserved,
	reduceScrollerViewportPhase,
} from "../scrollerViewportScrollPhase";

describe("reduceScrollerViewportPhase", () => {
	it("marks scroll start as active once", () => {
		const start = reduceScrollerViewportPhase({ type: "idle" }, "start");

		expect(start).toEqual({
			state: {
				type: "scrolling",
				pendingAfterScroll: {
					reconnectObserver: false,
					refreshDependencies: false,
					measureLayout: false,
				},
			},
			effect: { type: "scroll-start" },
		});

		expect(reduceScrollerViewportPhase(start.state, "start")).toEqual({
			state: {
				type: "scrolling",
				pendingAfterScroll: {
					reconnectObserver: false,
					refreshDependencies: false,
					measureLayout: false,
				},
			},
			effect: { type: "none" },
		});
	});

	it("records observer reconnect work during scroll", () => {
		const state = markScrollerViewportScrollObserved({
			type: "scrolling",
			pendingAfterScroll: {
				reconnectObserver: false,
				refreshDependencies: false,
				measureLayout: false,
			},
		});

		expect(state).toEqual({
			type: "scrolling",
			pendingAfterScroll: {
				reconnectObserver: true,
				refreshDependencies: false,
				measureLayout: false,
			},
		});
	});

	it("flushes pending work on idle", () => {
		const transition = reduceScrollerViewportPhase(
			{
				type: "scrolling",
				pendingAfterScroll: {
					reconnectObserver: true,
					refreshDependencies: false,
					measureLayout: true,
				},
			},
			"idle",
		);

		expect(transition).toEqual({
			state: { type: "idle" },
			effect: {
				type: "scroll-idle",
				refreshDependencies: false,
				measureLayout: true,
				measureScroll: false,
				reconnectObserver: true,
			},
		});
	});

	it("requests full dependency refresh only when a structure mutation was observed", () => {
		const transition = reduceScrollerViewportPhase(
			{
				type: "scrolling",
				pendingAfterScroll: {
					reconnectObserver: true,
					refreshDependencies: true,
					measureLayout: false,
				},
			},
			"idle",
		);

		expect(transition).toEqual({
			state: { type: "idle" },
			effect: {
				type: "scroll-idle",
				refreshDependencies: true,
				measureLayout: false,
				measureScroll: true,
				reconnectObserver: true,
			},
		});
	});

	it("marks after-scroll dependency and layout work only while scrolling", () => {
		expect(
			markScrollerViewportDependencyRefreshAfterScroll({ type: "idle" }),
		).toEqual({ type: "idle" });

		const state = markScrollerViewportLayoutMeasurementAfterScroll(
			markScrollerViewportDependencyRefreshAfterScroll({
				type: "scrolling",
				pendingAfterScroll: {
					reconnectObserver: false,
					refreshDependencies: false,
					measureLayout: false,
				},
			}),
		);

		expect(state).toEqual({
			type: "scrolling",
			pendingAfterScroll: {
				reconnectObserver: false,
				refreshDependencies: true,
				measureLayout: true,
			},
		});
	});
});
