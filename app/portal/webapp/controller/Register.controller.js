sap.ui.define([
	"supplier/portal/controller/BaseController",
	"sap/ui/model/json/JSONModel",
	"supplier/portal/model/api"
], (BaseController, JSONModel, api) => {
	"use strict";

	const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
	// the same five rules are enforced again in the backend (srv/supplier-service.js)
	const RULES = {
		length: (value) => value.length >= 8,
		upper: (value) => /[A-Z]/.test(value),
		lower: (value) => /[a-z]/.test(value),
		digit: (value) => /\d/.test(value),
		special: (value) => /[^A-Za-z0-9]/.test(value)
	};

	const checkRules = (password) =>
		Object.fromEntries(Object.entries(RULES).map(([key, test]) => [key, test(password)]));

	return BaseController.extend("supplier.portal.controller.Register", {
		onInit() {
			this.getView().setModel(new JSONModel(), "register");
			this.getRouter().getRoute("register").attachPatternMatched(this._onRouteMatched, this);
		},

		_onRouteMatched() {
			this.getView().getModel("register").setData({
				email: "",
				password: "",
				showPassword: false,
				rules: checkRules(""),
				busy: false,
				error: "",
				emailState: "None",
				emailStateText: "",
				passwordState: "None"
			});
		},

		onPasswordLiveChange(event) {
			const model = this.getView().getModel("register");
			const rules = checkRules(event.getParameter("value") || "");
			model.setProperty("/rules", rules);
			if (Object.values(rules).every(Boolean)) {
				model.setProperty("/passwordState", "None");
			}
		},

		onEmailChange() {
			this._validateEmail();
		},

		onTogglePassword() {
			const model = this.getView().getModel("register");
			model.setProperty("/showPassword", !model.getProperty("/showPassword"));
		},

		_validateEmail() {
			const model = this.getView().getModel("register");
			const valid = EMAIL_RE.test((model.getProperty("/email") || "").trim());
			model.setProperty("/emailState", valid ? "None" : "Error");
			model.setProperty("/emailStateText", valid ? "" : this.getText("emailInvalid"));
			return valid;
		},

		async onRegister() {
			const model = this.getView().getModel("register");
			const email = (model.getProperty("/email") || "").trim();
			const password = model.getProperty("/password") || "";
			const passwordOk = Object.values(checkRules(password)).every(Boolean);

			model.setProperty("/error", "");
			model.setProperty("/passwordState", passwordOk ? "None" : "Error");
			const emailOk = this._validateEmail();
			if (!emailOk || !passwordOk) {
				return;
			}

			model.setProperty("/busy", true);
			try {
				await api.register(email, password);
				// registration = login -> go straight to the application form
				this.getRouter().navTo("application", {}, true);
			} catch (error) {
				if (error.code === "EMAIL_ALREADY_EXISTS") {
					model.setProperty("/emailState", "Error");
					model.setProperty("/emailStateText", error.message);
				}
				model.setProperty("/error", error.message || this.getText("genericError"));
			} finally {
				model.setProperty("/busy", false);
			}
		},

		onNavToLogin() {
			this.getRouter().navTo("login");
		}
	});
});
