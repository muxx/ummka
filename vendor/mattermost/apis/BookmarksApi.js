import * as runtime from '../runtime.js';
import { ChannelBookmarkWithFileInfoFromJSON, } from '../models/ChannelBookmarkWithFileInfo.js';
export class BookmarksApi extends runtime.BaseAPI {
    async listChannelBookmarksForChannelRequestOpts(requestParameters) {
        if (requestParameters['channelId'] == null) {
            throw new runtime.RequiredError('channelId', 'Required parameter "channelId" was null or undefined when calling listChannelBookmarksForChannel().');
        }
        const queryParameters = {};
        if (requestParameters['bookmarksSince'] != null) {
            queryParameters['bookmarks_since'] = requestParameters['bookmarksSince'];
        }
        const headerParameters = {};
        if (this.configuration && this.configuration.accessToken) {
            const token = this.configuration.accessToken;
            const tokenString = await token("bearerAuth", []);
            if (tokenString) {
                headerParameters["Authorization"] = `Bearer ${tokenString}`;
            }
        }
        let urlPath = `/api/v4/channels/{channel_id}/bookmarks`;
        urlPath = urlPath.replace('{channel_id}', encodeURIComponent(String(requestParameters['channelId'])));
        return {
            path: urlPath,
            method: 'GET',
            headers: headerParameters,
            query: queryParameters,
        };
    }
    async listChannelBookmarksForChannelRaw(requestParameters, initOverrides) {
        const requestOptions = await this.listChannelBookmarksForChannelRequestOpts(requestParameters);
        const response = await this.request(requestOptions, initOverrides);
        return new runtime.JSONApiResponse(response, (jsonValue) => jsonValue.map(ChannelBookmarkWithFileInfoFromJSON));
    }
    async listChannelBookmarksForChannel(requestParameters, initOverrides) {
        const response = await this.listChannelBookmarksForChannelRaw(requestParameters, initOverrides);
        return await response.value();
    }
}
