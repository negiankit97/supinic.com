module.exports = class WebUtils {
	static get levels () {
		return {
			none: 1,
			login: 10,
			editor: 100,
			admin: 1000
		};
	}

	static apiFail (res, code = 500, message = "Unknown error", data = {}) {
		if (!res || typeof res.type !== "function") {
			throw new TypeError("Argument res must provided and be Express result");
		}

		return res.type("application/json")
			.status(code)
			.send(JSON.stringify({
				statusCode: code,
				timestamp: new Date().valueOf(),
				data: null,
				error: message
			}));
	}

	static apiSuccess (res, data = {}) {
		if (!res || typeof res.type !== "function") {
			throw new TypeError("Argument res must provided and be Express result");
		}

		return res.type("application/json")
			.status(200)
			.send(JSON.stringify({
				statusCode: 200,
				timestamp: new Date().valueOf(),
				data: sb.Utils.convertCaseObject(data, "snake", "camel"),
				error: null
			}));
	}

	/**
	 * Parses out user authentication and returns an object containing the level, or an error
	 * @param {Object} req
	 * @param {Object} res
	 * @returns Promise<UserLevelResult>
	 */
	static async getUserLevel (req, res) {
		if (req.query.auth_key && req.query.auth_user) {
			const userData = await sb.User.get(Number(req.query.auth_user));
			if (!userData) {
				return { error: "User identifier (query) is not valid a valid ID number" };
			}
			else if (!userData.Data.authKey || userData.Data.authKey !== req.query.auth_key) {
				return { error: "Access denied" };
			}

			return {
				level: userData.Data.trackLevel || "login",
				userID: userData.ID
			};
		}
		else if (req.header("Authorization")) {
			const [type, key] = req.header("Authorization").split(" ");
			if (type !== "Basic" || !key) {
				return { error: "Invalid Authorization header, must use \"Basic (user):(key)\"" };
			}

			const [userIdentifier, authKey] = key.split(":");
			const userData = await sb.User.get(Number(userIdentifier));

			if (!userData) {
				return { error: "User identifier (header) is not a valid ID number" };
			}
			else if (!authKey || userData.Data.authKey !== authKey) {
				return { error: "Access denied" };
			}

			return {
				level: userData.Data.trackLevel || "login",
				userID: userData.ID
			};
		}
		else if (!res.locals) {
			return { error: "Session timed out" };
		}
		else if (!res.locals.authUser || !res.locals.authUser.userData) {
			return { level: "none", userID: null };
		}
		else {
			return {
				level: res.locals.authUser.userData.Data.trackLevel || "login",
				userID: res.locals.authUser.userData.ID
			};
		}
	}

	/**
	 * Compares two levels and returns whether they have access
	 * @param {string} actual
	 * @param {string} required
	 * @returns {boolean}
	 */
	static compareLevels (actual, required) {
		if (!WebUtils.levels[actual] || !WebUtils.levels[required]) {
			throw new TypeError(`Invalid level(s): "${actual}", "${required}"`);
		}

		return WebUtils.levels[actual] >= WebUtils.levels[required];
	}

	static async apiLogRequest (req) {
		const row = await sb.Query.getRow("api", "Log");
		row.setValues({
			Method: req.method,
			Endpoint: req.baseUrl + req.url,
			Source_IP: req.header("X-Forwarded-For") || req.connection.remoteAddress,
			User_Agent: req.header("User-Agent") || null,
			Headers: JSON.stringify(req.headers),
			Query: JSON.stringify(req.query),
			Body: JSON.stringify(req.body)
		});

		return await row.save();
	}
};

/**
 * @typedef {Object} UserLevelResult
 * @property {string} [error] If set, an error was encountered during authentication and the endpoint should abort
 * @property {number|null} [userID] If set, hold the authenticated user's ID
 * @property {string} [level] If set, the request was authenticated properly
 */