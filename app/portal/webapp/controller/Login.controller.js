sap.ui.define([
	"supplier/portal/controller/BaseController",
	"sap/ui/model/json/JSONModel",
	"supplier/portal/model/api"
], (BaseController, JSONModel, api) => {
	"use strict";

	const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

	return BaseController.extend("supplier.portal.controller.Login", {
		onInit() {
			this.getView().setModel(new JSONModel(), "login");
			this.getRouter().getRoute("login").attachPatternMatched(this._onRouteMatched, this);
		},

		_onRouteMatched() {
			// already logged in (e.g. page reload) -> straight to the application
			if (api.session.isLoggedIn()) {
				this.getRouter().navTo("application", {}, true);
				return;
			}
			this.getView().getModel("login").setData({
				email: "",
				password: "",
				showPassword: false,
				busy: false,
				error: "",
				emailState: "None",
				passwordState: "None"
			});
		},

		onTogglePassword() {
			const model = this.getView().getModel("login");
			model.setProperty("/showPassword", !model.getProperty("/showPassword"));
		},

		async onLogin() {
			const model = this.getView().getModel("login");
			const email = (model.getProperty("/email") || "").trim();
			const password = model.getProperty("/password") || "";

			model.setProperty("/error", "");
			model.setProperty("/emailState", EMAIL_RE.test(email) ? "None" : "Error");
			model.setProperty("/passwordState", password ? "None" : "Error");
			if (!EMAIL_RE.test(email) || !password) {
				return;
			}

			model.setProperty("/busy", true);
			try {
				await api.login(email, password);
				this.getRouter().navTo("application", {}, true);
			} catch (error) {
				// wrong or unknown e-mail/password: the backend returns one generic message
				model.setProperty("/error", error.message || this.getText("genericError"));
			} finally {
				model.setProperty("/busy", false);
			}
		},

		onNavToRegister() {
			this.getRouter().navTo("register");
		}
	});
});
