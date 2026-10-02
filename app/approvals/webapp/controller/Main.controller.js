sap.ui.define([
	"sap/ui/core/mvc/Controller",
	"sap/ui/core/Fragment",
	"sap/ui/model/json/JSONModel",
	"sap/ui/model/Filter",
	"sap/ui/model/FilterOperator",
	"sap/ui/model/Sorter",
	"sap/m/MessageBox",
	"sap/m/MessageToast",
	"sap/base/strings/formatMessage",
	"supplier/approvals/model/processFlow"
], (Controller, Fragment, JSONModel, Filter, FilterOperator, Sorter, MessageBox, MessageToast, formatMessage, processFlow) => {
	"use strict";

	const DEFAULT_COLUMNS = ["companyName", "contactPerson", "email", "submittedAt", "status"];
	const ALL_COLUMNS = [...DEFAULT_COLUMNS, "phone", "country", "category", "taxNumber", "website", "address", "notes"];
	const STATUS_FILTERS = {
		pending: ["SUBMITTED", "IN_REVIEW"],
		approved: ["APPROVED"],
		rejected: ["REJECTED"]
	};
	const STATUS_STATE = { SUBMITTED: "Information", IN_REVIEW: "Warning", APPROVED: "Success", REJECTED: "Error" };

	const defaultColumns = () => Object.fromEntries(ALL_COLUMNS.map((column) => [column, DEFAULT_COLUMNS.includes(column)]));

	return Controller.extend("supplier.approvals.controller.Main", {
		formatMessage,

		onInit() {
			this.getView().setModel(
				new JSONModel({
					tab: "all",
					query: "",
					categories: [],
					sorter: { path: "submittedAt", descending: true },
					filtersActive: false,
					total: 0,
					counts: {},
					columns: defaultColumns()
				}),
				"view"
			);
			this.getView().setModel(new JSONModel({}), "detail");
			this._loadCounts();
		},

		// ------------------------------------------------------------ helpers

		_text(key, args) {
			return this.getOwnerComponent().getModel("i18n").getResourceBundle().getText(key, args);
		},

		_viewModel() {
			return this.getView().getModel("view");
		},

		_detailModel() {
			return this.getView().getModel("detail");
		},

		_showError(error) {
			MessageBox.error((error && error.message) || this._text("genericError"));
		},

		// formatters (called with the controller as "this")
		statusText(status) {
			return status ? this._text("status" + status) : "";
		},

		statusState(status) {
			return STATUS_STATE[status] || "None";
		},

		categoryText(category) {
			return category ? this._text("category" + category) : "";
		},

		decisionSourceText(source) {
			return source ? this._text("decisionSource" + source) : "";
		},

		// ------------------------------------------------------------ counts, filters, search

		async _loadCounts() {
			try {
				const binding = this.getOwnerComponent().getModel().bindContext("/getStatusCounts()");
				const counts = await binding.getBoundContext().requestObject();
				this._viewModel().setProperty("/counts", counts);
			} catch {
				// the table shows the real error (e.g. 403); counts are optional
			}
		},

		onTableUpdateFinished(event) {
			this._viewModel().setProperty("/total", event.getParameter("total"));
		},

		onTabSelect() {
			this._applyFilters();
		},

		onSearch() {
			this._applyFilters();
		},

		/** Combines tab (status), search and settings filters with AND; every group is an OR list. */
		_applyFilters() {
			const view = this._viewModel().getData();
			const filters = [];

			const statuses = STATUS_FILTERS[view.tab];
			if (statuses) {
				filters.push(new Filter({ filters: statuses.map((s) => new Filter("status", FilterOperator.EQ, s)), and: false }));
			}

			const query = (view.query || "").trim();
			if (query) {
				filters.push(
					new Filter({
						filters: ["companyName", "contactPerson", "email"].map(
							(path) => new Filter({ path, operator: FilterOperator.Contains, value1: query, caseSensitive: false })
						),
						and: false
					})
				);
			}

			if (view.categories.length) {
				filters.push(new Filter({ filters: view.categories.map((c) => new Filter("category", FilterOperator.EQ, c)), and: false }));
			}

			const binding = this.byId("suppliersTable").getBinding("items");
			binding.filter(filters.length ? new Filter({ filters, and: true }) : [], "Application");
			binding.sort(new Sorter(view.sorter.path, view.sorter.descending));

			this._viewModel().setProperty("/filtersActive", !!(statuses || query || view.categories.length));
		},

		onClearFilters() {
			const model = this._viewModel();
			model.setProperty("/tab", "all");
			model.setProperty("/query", "");
			model.setProperty("/categories", []);
			if (this._settingsDialog) {
				this._settingsDialog.clearFilters();
			}
			this._applyFilters();
		},

		// ------------------------------------------------------------ settings dialog

		async onOpenSettings() {
			if (!this._settingsDialog) {
				this._settingsDialog = await Fragment.load({
					id: this.getView().getId(),
					name: "supplier.approvals.fragment.SettingsDialog",
					controller: this
				});
				this.getView().addDependent(this._settingsDialog);
			}
			this._settingsDialog.open();
		},

		onSettingsConfirm(event) {
			const sortItem = event.getParameter("sortItem");
			const categories = event.getParameter("filterItems").map((item) => item.getKey());
			const model = this._viewModel();
			model.setProperty("/sorter", {
				path: sortItem ? sortItem.getKey() : "submittedAt",
				descending: event.getParameter("sortDescending")
			});
			model.setProperty("/categories", categories);
			this._applyFilters();
		},

		onSettingsReset() {
			this._viewModel().setProperty("/columns", defaultColumns());
		},

		// ------------------------------------------------------------ detail dialog

		async onOpenDetail(event) {
			const rowContext = event.getSource().getBindingContext();
			const dialog = await this._getDetailDialog();
			this._detailModel().setData({
				comment: "",
				commentState: "None",
				revisionFields: ["certificate"],
				aiMessage: "",
				aiMessageType: "Information"
			});
			this.byId("detailFlowContainer").destroyItems();

			// opening a submitted application moves it to "In review"
			if (rowContext.getProperty("status") === "SUBMITTED") {
				try {
					await this._invoke("startReview", rowContext);
				} catch (error) {
					this._showError(error);
				}
				this._refreshList();
			}

			// own element binding -> independent from the table (which gets refreshed after decisions)
			dialog.bindElement({ path: rowContext.getPath() });
			// draw the process flow once the dialog is fully open (ProcessFlow measures its container)
			dialog.attachEventOnce("afterOpen", () => this._updateFlow());
			dialog.open();
		},

		async _getDetailDialog() {
			if (!this._detailDialog) {
				this._detailDialog = await Fragment.load({
					id: this.getView().getId(),
					name: "supplier.approvals.fragment.DetailDialog",
					controller: this
				});
				this.getView().addDependent(this._detailDialog);
			}
			return this._detailDialog;
		},

		async _updateFlow() {
			const context = this._detailDialog.getBindingContext();
			if (!context) {
				return;
			}
			const [status, submittedAt, decidedAt] = await context.requestProperty(["status", "submittedAt", "decidedAt"]);
			const bundle = this.getOwnerComponent().getModel("i18n").getResourceBundle();
			processFlow.render(this.byId("detailFlowContainer"), { status, submittedAt, decidedAt }, bundle);
		},

		onCommentChange(event) {
			if (event.getParameter("value").trim()) {
				this._detailModel().setProperty("/commentState", "None");
			}
		},

		onCloseDetail() {
			this._detailDialog.close();
		},

		onDetailAfterClose() {
			this._detailDialog.unbindElement();
		},

		// ------------------------------------------------------------ decisions (bound OData actions)

		/** Invokes a bound action of SupplierService.Suppliers and returns its result (if any). */
		async _invoke(action, context, parameters = {}) {
			const operation = this.getOwnerComponent()
				.getModel()
				.bindContext(`SupplierService.${action}(...)`, context);
			Object.entries(parameters).forEach(([name, value]) => operation.setParameter(name, value));
			await operation.invoke();
			const result = operation.getBoundContext();
			return result ? result.getObject() : undefined;
		},

		async _afterDecision(message) {
			if (message) {
				MessageToast.show(message);
			}
			this._detailDialog.getElementBinding().refresh();
			await this._updateFlow();
			this._refreshList();
		},

		_refreshList() {
			this.byId("suppliersTable").getBinding("items").refresh();
			this._loadCounts();
		},

		async _decide(action, parameters, successText) {
			const dialog = this._detailDialog;
			dialog.setBusy(true);
			try {
				const result = await this._invoke(action, dialog.getBindingContext(), parameters);
				await this._afterDecision(successText);
				return result;
			} catch (error) {
				this._showError(error);
				// e.g. someone else decided meanwhile -> show the current state
				await this._afterDecision();
				return undefined;
			} finally {
				dialog.setBusy(false);
			}
		},

		onApprove() {
			this._decide("approveApplication", {}, this._text("approveSuccess"));
		},

		onReject() {
			const detail = this._detailModel();
			const comment = (detail.getProperty("/comment") || "").trim();
			if (!comment) {
				// required on the client too; the backend rejects an empty comment as well
				detail.setProperty("/commentState", "Error");
				this.byId("rejectComment").focus();
				return;
			}
			this._decide(
				"rejectApplication",
				{ comment, revisionFields: detail.getProperty("/revisionFields").join(",") },
				this._text("rejectSuccess")
			);
		},

		async onAnalyzeWithAI() {
			const detail = this._detailModel();
			detail.setProperty("/aiMessage", this._text("aiRunning"));
			detail.setProperty("/aiMessageType", "Information");
			const result = await this._decide("analyzeWithAI", {});
			if (!result) {
				detail.setProperty("/aiMessage", "");
				return;
			}
			const approved = result.status === "APPROVED";
			detail.setProperty("/aiMessage", this._text(approved ? "aiApproved" : "aiRejected", [result.reason]));
			detail.setProperty("/aiMessageType", approved ? "Success" : "Error");
		}
	});
});
