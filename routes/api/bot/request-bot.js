/* global sb */
module.exports = (function () {
	"use strict";

	const Express = require("express");
	const Router = Express.Router();

	const Channel = require("../../../modules/chat-data/channel.js");
	const Suggestion = require("../../../modules/data/suggestion.js");

	Router.post("/", async (req, res) => {
		const { userID } = await sb.WebUtils.getUserLevel(req, res);
		if (!userID) {
			return sb.WebUtils.apiFail(res, 401, "Not logged in");
		}

		const { description, renamedChannel, targetChannel } = req.body;
		if (!targetChannel && !renamedChannel) {
			return sb.WebUtils.apiFail(res, 400, "No target or rename channel provided");
		}

		if (renamedChannel) {
			const userData = await sb.User.get(userID);
			const renamed = await Channel.selectSingleCustom(q => q.where("Name = %s", renamedChannel));
			if (!renamed) {
				return sb.WebUtils.apiFail(res, 400, "Provided channel has not been found");
			}
			else if (renamed.Mode === "Inactive") {
				return sb.WebUtils.apiFail(res, 400, "Provided channel has already been deactivated");
			}

			const currentChannelID = userData.Twitch_ID ?? await sb.Utils.getTwitchID(userData.Name);
			const previousChannelID = renamed.Specific_ID;
			if (currentChannelID !== previousChannelID) {
				return sb.WebUtils.apiFail(res, 400, "Renaming verification did not pass");
			}

			const renamedRow = await sb.Query.getRow("chat_data", "Channel");
			await renamedRow.load(renamed.ID);
			renamedRow.values.Mode = "Inactive";
			await renamedRow.save();

			const newRow = await sb.Query.getRow("chat_data", "Channel");
			newRow.setValues({
				Name: userData.Name,
				Platform: 1,
				Specific_ID: currentChannelID,
				Mode: "Write"
			});
			await newRow.save();

			await sb.WebUtils.invalidateBotCache({ type: "channel" });
			await sb.InternalRequest.send({
				type: "join-channel",
				platform: "twitch",
				channel: userData.Name
			});

			return sb.WebUtils.apiSuccess(res, {
				success: true,
				suggestionID: null
			});
		}

		const exists = await Channel.selectSingleCustom(rs => rs
			.where("Name = %s", targetChannel)
			.where("Platform = %n", 1)
		);

		if (exists) {
			if (exists.Mode === "Inactive") {
				return sb.WebUtils.apiFail(res, 400, "The bot has been removed from target channel, contact Supinic to resolve this");
			}
			else {
				return sb.WebUtils.apiFail(res, 400, "Target channel already has the bot");
			}
		}
		else if (await sb.Utils.getTwitchID(targetChannel) === null) {
			return sb.WebUtils.apiFail(res, 400, "Target channel does not exist on Twitch");
		}

		const userData = await sb.User.get(userID);
		if (userData.Name !== targetChannel) {
			const escapedChannel = targetChannel.replace(/\W/g, "").toLowerCase();
			const { mods } = await sb.Got.instances.Leppunen("twitch/modsvips/" + escapedChannel).json();
			const isModerator = mods.find(i => i.login === userData.Name);

			if (!isModerator) {
				return sb.WebUtils.apiFail(res, 403, "You are not a moderator in the target channel");
			}
		}

		const { insertId } = await Suggestion.insert({
			User_Alias: userData.ID,
			Category: "Bot addition",
			Notes: "Requested via website",
			Priority: 255,
			Text: `Channel: ${targetChannel}, requested by: ${userData.Name}, description: ${description ?? "N/A"}`
		});

		return sb.WebUtils.apiSuccess(res, {
			success: true,
			suggestionID: insertId
		});
	});

	return Router;
})();