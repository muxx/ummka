import * as runtime from '../runtime.js';
import { EmojiFromJSON, } from '../models/Emoji.js';
export class EmojiApi extends runtime.BaseAPI {
    async getEmojiByNameRequestOpts(requestParameters) {
        if (requestParameters['emojiName'] == null) {
            throw new runtime.RequiredError('emojiName', 'Required parameter "emojiName" was null or undefined when calling getEmojiByName().');
        }
        const queryParameters = {};
        const headerParameters = {};
        if (this.configuration && this.configuration.accessToken) {
            const token = this.configuration.accessToken;
            const tokenString = await token("bearerAuth", []);
            if (tokenString) {
                headerParameters["Authorization"] = `Bearer ${tokenString}`;
            }
        }
        let urlPath = `/api/v4/emoji/name/{emoji_name}`;
        urlPath = urlPath.replace('{emoji_name}', encodeURIComponent(String(requestParameters['emojiName'])));
        return {
            path: urlPath,
            method: 'GET',
            headers: headerParameters,
            query: queryParameters,
        };
    }
    async getEmojiByNameRaw(requestParameters, initOverrides) {
        const requestOptions = await this.getEmojiByNameRequestOpts(requestParameters);
        const response = await this.request(requestOptions, initOverrides);
        return new runtime.JSONApiResponse(response, (jsonValue) => EmojiFromJSON(jsonValue));
    }
    async getEmojiByName(requestParameters, initOverrides) {
        const response = await this.getEmojiByNameRaw(requestParameters, initOverrides);
        return await response.value();
    }
}
