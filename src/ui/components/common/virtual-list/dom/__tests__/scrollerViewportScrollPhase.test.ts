import { describe, expect, it } from "vitest";
import {
	markScrollerViewportDependencyRefreshAfterScroll,
	markScrollerViewportLayoutMeasurementAfterScroll,
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
		const transition = reduceScrollerViewportPhase(
			{
				type: "scrolling",
				pendingAfterScroll: {
					reconnectObserver: false,
					refreshDependencies: false,
					measureLayout: false,
				},
			},
			"scroll",
		);

		expect(transition).toEqual({
			state: {
				type: "scrolling",
				pendingAfterScroll: {
					reconnectObserver: true,
					refreshDependencies: false,
					measureLayout: false,
				},
			},
			effect: { type: "scroll-frame", measureScroll: true },
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
				refreshDependencies: true,
				measureLayout: true,
				measureScroll: false,
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
