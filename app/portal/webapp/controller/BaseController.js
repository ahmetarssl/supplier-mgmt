sap.ui.define([
	"sap/ui/core/mvc/Controller",
	"sap/m/MessageBox",
	"supplier/portal/model/api"
], (Controller, MessageBox, api) => {
	"use strict";

	return Controller.extend("supplier.portal.controller.BaseController", {
		getRouter() {
			return this.getOwnerComponent().getRouter();
		},

		getText(key, args) {
			return this.getOwnerComponent().getModel("i18n").getResourceBundle().getText(key, args);
		},

		/** Shows backend/network errors; on an invalid session sends the user back to the login. */
		handleError(error) {
			if (error instanceof api.ApiError && error.isSessionError) {
				api.session.clear();
				MessageBox.warning(this.getText("sessionExpired"));
				this.getRouter().navTo("login", {}, true);
				return;
			}
			let message = error && error.message;
			if (error && error.code === "NETWORK") {
				message = this.getText("networkError");
			}
			MessageBox.error(message || this.getText("genericError"));
		}
	});
});
