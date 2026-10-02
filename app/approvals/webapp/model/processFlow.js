sap.ui.define([
	"sap/ui/core/format/DateFormat",
	"sap/suite/ui/commons/ProcessFlow",
	"sap/suite/ui/commons/ProcessFlowLaneHeader",
	"sap/suite/ui/commons/ProcessFlowNode"
], (DateFormat, ProcessFlow, ProcessFlowLaneHeader, ProcessFlowNode) => {
	"use strict";

	/**
	 * Builds the data for sap.suite.ui.commons.ProcessFlow:
	 *   Submitted -> In review -> Result (Approved / Rejected)
	 * The same file exists in the portal app, so both sides always show the same picture.
	 */
	const dateFormat = DateFormat.getDateTimeInstance({ style: "medium" });
	const formatDate = (value) => (value ? dateFormat.format(new Date(value)) : "");

	function build(application, bundle) {
		const t = (key) => bundle.getText(key);
		const status = application.status;
		const decided = status === "APPROVED" || status === "REJECTED";
		const inReviewOrLater = status === "IN_REVIEW" || decided;

		let reviewState = "Planned";
		let reviewStateText = t("statePlanned");
		if (decided) {
			reviewState = "Positive";
			reviewStateText = t("stateDone");
		} else if (inReviewOrLater) {
			reviewState = "Neutral";
			reviewStateText = t("stateCurrent");
		}

		let resultState = "Planned";
		let resultTitle = t("nodeWaiting");
		if (status === "APPROVED") {
			resultState = "Positive";
			resultTitle = t("nodeApproved");
		} else if (status === "REJECTED") {
			resultState = "Negative";
			resultTitle = t("nodeRejected");
		}

		const laneState = (state) => [{ state, value: 100 }];

		return {
			lanes: [
				{ id: "submitted", icon: "sap-icon://paper-plane", label: t("laneSubmitted"), position: 0, state: laneState("Positive") },
				{ id: "review", icon: "sap-icon://inspection", label: t("laneInReview"), position: 1, state: laneState(reviewState) },
				{ id: "result", icon: "sap-icon://approvals", label: t("laneResult"), position: 2, state: laneState(resultState) }
			],
			nodes: [
				{
					id: "1",
					lane: "submitted",
					title: t("nodeSubmitted"),
					state: "Positive",
					stateText: t("stateDone"),
					texts: [formatDate(application.submittedAt)],
					children: ["2"]
				},
				{
					id: "2",
					lane: "review",
					title: t("nodeInReview"),
					state: reviewState,
					stateText: reviewStateText,
					texts: [],
					children: ["3"]
				},
				{
					id: "3",
					lane: "result",
					title: resultTitle,
					state: resultState,
					stateText: decided ? t("stateDone") : t("statePlanned"),
					texts: [formatDate(application.decidedAt)],
					children: []
				}
			]
		};
	}

	/**
	 * Replaces the content of a container with a freshly created ProcessFlow.
	 * (Re-binding the nodes of an existing ProcessFlow leads to duplicate-ID errors,
	 * so a new control is created whenever the status changes.)
	 */
	function render(container, application, bundle) {
		const data = build(application, bundle);
		const flow = new ProcessFlow({
			scrollable: false,
			wheelZoomable: false,
			lanes: data.lanes.map((lane) => new ProcessFlowLaneHeader({
				laneId: lane.id,
				iconSrc: lane.icon,
				text: lane.label,
				position: lane.position,
				state: lane.state
			})),
			nodes: data.nodes.map((node) => new ProcessFlowNode({
				nodeId: node.id,
				laneId: node.lane,
				title: node.title,
				state: node.state,
				stateText: node.stateText,
				texts: node.texts,
				children: node.children
			}))
		});
		container.destroyItems();
		container.addItem(flow);
	}

	return { build, render };
});
