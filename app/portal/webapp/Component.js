sap.ui.define(["sap/ui/core/UIComponent"], (UIComponent) => {
	"use strict";

	return UIComponent.extend("supplier.portal.Component", {
		metadata: {
			manifest: "json",
			interfaces: ["sap.ui.core.IAsyncContentCreation"]
		},

		init() {
			UIComponent.prototype.init.apply(this, arguments);
			this.getRouter().initialize();
			// standalone (outside the launchpad): browser tab title from i18n as well
			if (!sap.ui.require("sap/ushell/Container")) {
				document.title = this.getModel("i18n").getResourceBundle().getText("appTitle");
			}
		}
	});
});
