sap.ui.define([
	"supplier/portal/controller/BaseController",
	"sap/ui/model/json/JSONModel",
	"sap/m/MessageBox",
	"sap/m/MessageToast",
	"sap/base/strings/formatMessage",
	"sap/ui/unified/FileUploaderParameter",
	"sap/ui/unified/library",
	"supplier/portal/model/api",
	"supplier/portal/model/processFlow"
], (BaseController, JSONModel, MessageBox, MessageToast, formatMessage, FileUploaderParameter, unifiedLibrary, api, processFlow) => {
	"use strict";

	const FORM_FIELDS = ["companyName", "contactPerson", "phone", "country", "category", "taxNumber", "website", "address", "notes"];
	const REQUIRED_FIELDS = ["companyName", "contactPerson"];
	const STATUS_MESSAGE_TYPE = { SUBMITTED: "Information", IN_REVIEW: "Information", APPROVED: "Success", REJECTED: "Error" };

	const emptyForm = () => Object.fromEntries(FORM_FIELDS.map((field) => [field, ""]));
	const allEditable = (value) => Object.fromEntries([...FORM_FIELDS, "certificate"].map((field) => [field, value]));

	return BaseController.extend("supplier.portal.controller.Application", {
		formatMessage,

		onInit() {
			this.getView().setModel(new JSONModel({ mode: "loading", busy: false }), "app");
			this.byId("certificateUploader").setHttpRequestMethod(unifiedLibrary.FileUploaderHttpRequestMethod.Put);
			this.getRouter().getRoute("application").attachPatternMatched(this._onRouteMatched, this);
		},

		_model() {
			return this.getView().getModel("app");
		},

		_onRouteMatched() {
			if (!api.session.isLoggedIn()) {
				this.getRouter().navTo("login", {}, true);
				return;
			}
			this._model().setProperty("/email", api.session.getEmail());
			this._load();
		},

		async _load() {
			this._model().setProperty("/busy", true);
			try {
				this._showApplication(await api.getMyApplication());
			} catch (error) {
				this.handleError(error);
			} finally {
				this._model().setProperty("/busy", false);
			}
		},

		/** No application yet or still a draft -> form. Submitted at least once -> only the process flow. */
		_showApplication(application) {
			this._resetUploader();
			this._model().setProperty("/application", application);
			if (!application || application.status === "DRAFT") {
				this._openForm("form", application, allEditable(true));
				return;
			}
			const bundle = this.getOwnerComponent().getModel("i18n").getResourceBundle();
			const revisionLabels = (application.revisionFields || "")
				.split(",")
				.filter(Boolean)
				.map((field) => this.getText(field));
			this._model().setProperty("/mode", "status");
			processFlow.render(this.byId("flowContainer"), application, bundle);
			this._model().setProperty("/statusMessage", this.getText("status" + application.status));
			this._model().setProperty("/statusType", STATUS_MESSAGE_TYPE[application.status] || "Information");
			this._model().setProperty("/revisionText", this.getText("revisionFieldsLabel", [revisionLabels.join(", ")]));
		},

		_openForm(mode, application, editable) {
			const form = emptyForm();
			if (application) {
				FORM_FIELDS.forEach((field) => (form[field] = application[field] || ""));
			}
			this._model().setProperty("/mode", mode);
			this._model().setProperty("/form", form);
			this._model().setProperty("/editable", editable);
			this._model().setProperty("/state", { companyName: "None", contactPerson: "None", certificate: "None" });
			this._model().setProperty("/certificateStateText", "");
		},

		// ------------------------------------------------------------ re-apply

		onReapply() {
			const application = this._model().getProperty("/application");
			const allowed = (application.revisionFields || "").split(",");
			// previous values are pre-filled; only the requested fields stay editable
			const editable = allEditable(false);
			allowed.forEach((field) => {
				if (field in editable) {
					editable[field] = true;
				}
			});
			this._resetUploader();
			this._openForm("reapply", application, editable);
		},

		onCancelReapply() {
			this._showApplication(this._model().getProperty("/application"));
		},

		// ------------------------------------------------------------ validation

		onRequiredChange(event) {
			const input = event.getSource();
			const field = input.getId().split("--").pop();
			this._model().setProperty(`/state/${field}`, input.getValue().trim() ? "None" : "Error");
		},

		_needsNewCertificate() {
			const mode = this._model().getProperty("/mode");
			const application = this._model().getProperty("/application");
			if (mode === "reapply") {
				return this._model().getProperty("/editable/certificate");
			}
			return !(application && application.certificateFileName);
		},

		_validate() {
			let valid = true;
			REQUIRED_FIELDS.forEach((field) => {
				const ok = !!(this._model().getProperty(`/form/${field}`) || "").trim();
				this._model().setProperty(`/state/${field}`, ok ? "None" : "Error");
				valid = valid && ok;
			});
			if (this._needsNewCertificate() && !this._hasFile) {
				const mode = this._model().getProperty("/mode");
				this._setCertificateError(this.getText(mode === "reapply" ? "certificateNewRequired" : "fieldRequired"));
				valid = false;
			}
			return valid;
		},

		// ------------------------------------------------------------ certificate

		onCertificateChange(event) {
			const files = event.getParameter("files");
			this._hasFile = !!(files && files.length);
			if (this._hasFile) {
				this._model().setProperty("/state/certificate", "None");
			}
		},

		onCertificateTypeMismatch(event) {
			this._rejectFile(this.getText("certificateTypeError", [event.getParameter("fileName")]));
		},

		onCertificateSizeExceed(event) {
			this._rejectFile(this.getText("certificateSizeError", [event.getParameter("fileName")]));
		},

		_rejectFile(message) {
			this._resetUploader();
			this._setCertificateError(message);
			MessageBox.error(message);
		},

		_setCertificateError(message) {
			this._model().setProperty("/state/certificate", "Error");
			this._model().setProperty("/certificateStateText", message);
		},

		_resetUploader() {
			this.byId("certificateUploader").clear();
			this._hasFile = false;
		},

		/** PUT the selected file as media data: /CertificateUploads(<ID>)/certificate */
		_uploadCertificate(applicationId) {
			const uploader = this.byId("certificateUploader");
			uploader.setUploadUrl(api.certificateUploadUrl(applicationId));
			uploader.removeAllHeaderParameters();
			const headers = Object.assign(api.baseHeaders(), { slug: encodeURIComponent(uploader.getValue()) });
			Object.entries(headers).forEach(([name, value]) => {
				uploader.addHeaderParameter(new FileUploaderParameter({ name, value }));
			});

			return new Promise((resolve, reject) => {
				uploader.attachEventOnce("uploadComplete", (event) => {
					const status = event.getParameter("status");
					if (status >= 200 && status < 300) {
						resolve();
						return;
					}
					let payload = null;
					try {
						payload = JSON.parse(event.getParameter("responseRaw"));
					} catch {
						// non-JSON error page
					}
					reject(api.toApiError(payload, status));
				});
				uploader.checkFileReadable().then(() => uploader.upload(), reject);
			});
		},

		// ------------------------------------------------------------ submit

		async onSubmit() {
			if (!this._validate()) {
				MessageToast.show(this.getText("validationFailed"));
				return;
			}
			this._model().setProperty("/busy", true);
			try {
				// 1) save the form data (creates the draft on first submit)
				const saved = await api.saveApplication(this._model().getProperty("/form"));
				// 2) upload the certificate (needs the application ID)
				if (this._hasFile) {
					await this._uploadCertificate(saved.ID);
					this._resetUploader();
				}
				// 3) submit: the backend checks required fields + certificate once more
				const submitted = await api.submitApplication();
				MessageToast.show(this.getText("submitSuccess"));
				this._showApplication(submitted);
			} catch (error) {
				if (/^CERTIFICATE_/.test(error.code || "")) {
					this._setCertificateError(error.message);
				}
				this.handleError(error);
				// keep the draft ID / file name shown if the upload failed
				api.getMyApplication().then((application) => this._model().setProperty("/application", application), () => {});
			} finally {
				this._model().setProperty("/busy", false);
			}
		},

		async onLogout() {
			try {
				await api.logout();
			} finally {
				this.getRouter().navTo("login", {}, true);
			}
		}
	});
});
