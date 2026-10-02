sap.ui.define(["sap/base/i18n/Localization"], (Localization) => {
	"use strict";

	/**
	 * Thin client for the public part of SupplierService.
	 * Suppliers are not BTP users: they are identified by the token returned from
	 * register/login, sent back in the X-Supplier-Token header. The approuter routes these
	 * paths with authenticationType "none" (see approuter/xs-app.json).
	 */
	const BASE_URL = "/odata/v4/supplier/";
	const TOKEN_KEY = "supplierPortal.token";
	const EMAIL_KEY = "supplierPortal.email";

	class ApiError extends Error {
		constructor(message, code, status) {
			super(message);
			this.code = code;
			this.status = status;
		}

		get isSessionError() {
			return this.code === "SESSION_REQUIRED" || this.code === "SESSION_EXPIRED";
		}
	}

	const session = {
		getToken: () => sessionStorage.getItem(TOKEN_KEY),
		getEmail: () => sessionStorage.getItem(EMAIL_KEY),
		isLoggedIn: () => !!sessionStorage.getItem(TOKEN_KEY),
		save(result) {
			sessionStorage.setItem(TOKEN_KEY, result.token);
			sessionStorage.setItem(EMAIL_KEY, result.email);
		},
		clear() {
			sessionStorage.removeItem(TOKEN_KEY);
			sessionStorage.removeItem(EMAIL_KEY);
		}
	};

	/** Headers every request needs: language (for translated backend messages) + session token. */
	function baseHeaders() {
		const headers = { "Accept-Language": Localization.getLanguageTag().toString() };
		const token = session.getToken();
		if (token) {
			headers["X-Supplier-Token"] = token;
		}
		return headers;
	}

	/** Turns a CAP error payload into one readable message (validation errors come as "details"). */
	function toApiError(payload, status) {
		const error = payload && payload.error;
		if (!error) {
			return new ApiError(null, "HTTP_" + status, status);
		}
		const details = (error.details || []).map((detail) => detail.message);
		const message = details.length ? details.join("\n") : error.message;
		const code = error.details && error.details.length ? error.details[0].code : error.code;
		return new ApiError(message, code, status);
	}

	async function request(path, { method = "POST", body } = {}) {
		const headers = Object.assign({ Accept: "application/json" }, baseHeaders());
		if (body !== undefined) {
			headers["Content-Type"] = "application/json";
		}
		let response;
		try {
			response = await fetch(BASE_URL + path, {
				method,
				headers,
				body: body === undefined ? undefined : JSON.stringify(body)
			});
		} catch {
			throw new ApiError(null, "NETWORK", 0);
		}
		if (response.status === 204) {
			return null;
		}
		const payload = await response.json().catch(() => null);
		if (!response.ok) {
			throw toApiError(payload, response.status);
		}
		return payload;
	}

	return {
		ApiError,
		session,
		baseHeaders,
		toApiError,

		certificateUploadUrl: (applicationId) => `${BASE_URL}CertificateUploads(${applicationId})/certificate`,

		async register(email, password) {
			const result = await request("register", { body: { email, password } });
			session.save(result);
			return result;
		},

		async login(email, password) {
			const result = await request("login", { body: { email, password } });
			session.save(result);
			return result;
		},

		async logout() {
			try {
				await request("logout", { body: {} });
			} finally {
				session.clear();
			}
		},

		/** @returns {Promise<object|null>} the application of the logged-in supplier or null */
		async getMyApplication() {
			const result = await request("getMyApplication()", { method: "GET" });
			return result && result.ID ? result : null;
		},

		saveApplication: (form) => request("saveApplication", { body: form }),

		submitApplication: () => request("submitApplication", { body: {} })
	};
});
