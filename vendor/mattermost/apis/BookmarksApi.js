import * as runtime from '../runtime.js';
import { ChannelBookmarkWithFileInfoFromJSON, } from '../models/ChannelBookmarkWithFileInfo.js';
import { CreateChannelBookmarkRequestToJSON, } from '../models/CreateChannelBookmarkRequest.js';
import { UpdateChannelBookmarkRequestToJSON, } from '../models/UpdateChannelBookmarkRequest.js';
import { UpdateChannelBookmarkResponseFromJSON, } from '../models/UpdateChannelBookmarkResponse.js';
export class BookmarksApi extends runtime.BaseAPI {
    async createChannelBookmarkRequestOpts(requestParameters) {
        if (requestParameters['channelId'] == null) {
            throw new runtime.RequiredError('channelId', 'Required parameter "channelId" was null or undefined when calling createChannelBookmark().');
        }
        if (requestParameters['createChannelBookmarkRequest'] == null) {
            throw new runtime.RequiredError('createChannelBookmarkRequest', 'Required parameter "createChannelBookmarkRequest" was null or undefined when calling createChannelBookmark().');
        }
        const queryParameters = {};
        const headerParameters = {};
        headerParameters['Content-Type'] = 'application/json';
        if (requestParameters['connectionId'] != null) {
            headerParameters['Connection-Id'] = String(requestParameters['connectionId']);
        }
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
            method: 'POST',
            headers: headerParameters,
            query: queryParameters,
            body: CreateChannelBookmarkRequestToJSON(requestParameters['createChannelBookmarkRequest']),
        };
    }
    async createChannelBookmarkRaw(requestParameters, initOverrides) {
        const requestOptions = await this.createChannelBookmarkRequestOpts(requestParameters);
        const response = await this.request(requestOptions, initOverrides);
        return new runtime.JSONApiResponse(response, (jsonValue) => ChannelBookmarkWithFileInfoFromJSON(jsonValue));
    }
    async createChannelBookmark(requestParameters, initOverrides) {
        const response = await this.createChannelBookmarkRaw(requestParameters, initOverrides);
        return await response.value();
    }
    async deleteChannelBookmarkRequestOpts(requestParameters) {
        if (requestParameters['channelId'] == null) {
            throw new runtime.RequiredError('channelId', 'Required parameter "channelId" was null or undefined when calling deleteChannelBookmark().');
        }
        if (requestParameters['bookmarkId'] == null) {
            throw new runtime.RequiredError('bookmarkId', 'Required parameter "bookmarkId" was null or undefined when calling deleteChannelBookmark().');
        }
        const queryParameters = {};
        const headerParameters = {};
        if (requestParameters['connectionId'] != null) {
            headerParameters['Connection-Id'] = String(requestParameters['connectionId']);
        }
        if (this.configuration && this.configuration.accessToken) {
            const token = this.configuration.accessToken;
            const tokenString = await token("bearerAuth", []);
            if (tokenString) {
                headerParameters["Authorization"] = `Bearer ${tokenString}`;
            }
        }
        let urlPath = `/api/v4/channels/{channel_id}/bookmarks/{bookmark_id}`;
        urlPath = urlPath.replace('{channel_id}', encodeURIComponent(String(requestParameters['channelId'])));
        urlPath = urlPath.replace('{bookmark_id}', encodeURIComponent(String(requestParameters['bookmarkId'])));
        return {
            path: urlPath,
            method: 'DELETE',
            headers: headerParameters,
            query: queryParameters,
        };
    }
    async deleteChannelBookmarkRaw(requestParameters, initOverrides) {
        const requestOptions = await this.deleteChannelBookmarkRequestOpts(requestParameters);
        const response = await this.request(requestOptions, initOverrides);
        return new runtime.JSONApiResponse(response, (jsonValue) => ChannelBookmarkWithFileInfoFromJSON(jsonValue));
    }
    async deleteChannelBookmark(requestParameters, initOverrides) {
        const response = await this.deleteChannelBookmarkRaw(requestParameters, initOverrides);
        return await response.value();
    }
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
    async updateChannelBookmarkRequestOpts(requestParameters) {
        if (requestParameters['channelId'] == null) {
            throw new runtime.RequiredError('channelId', 'Required parameter "channelId" was null or undefined when calling updateChannelBookmark().');
        }
        if (requestParameters['bookmarkId'] == null) {
            throw new runtime.RequiredError('bookmarkId', 'Required parameter "bookmarkId" was null or undefined when calling updateChannelBookmark().');
        }
        if (requestParameters['updateChannelBookmarkRequest'] == null) {
            throw new runtime.RequiredError('updateChannelBookmarkRequest', 'Required parameter "updateChannelBookmarkRequest" was null or undefined when calling updateChannelBookmark().');
        }
        const queryParameters = {};
        const headerParameters = {};
        headerParameters['Content-Type'] = 'application/json';
        if (requestParameters['connectionId'] != null) {
            headerParameters['Connection-Id'] = String(requestParameters['connectionId']);
        }
        if (this.configuration && this.configuration.accessToken) {
            const token = this.configuration.accessToken;
            const tokenString = await token("bearerAuth", []);
            if (tokenString) {
                headerParameters["Authorization"] = `Bearer ${tokenString}`;
            }
        }
        let urlPath = `/api/v4/channels/{channel_id}/bookmarks/{bookmark_id}`;
        urlPath = urlPath.replace('{channel_id}', encodeURIComponent(String(requestParameters['channelId'])));
        urlPath = urlPath.replace('{bookmark_id}', encodeURIComponent(String(requestParameters['bookmarkId'])));
        return {
            path: urlPath,
            method: 'PATCH',
            headers: headerParameters,
            query: queryParameters,
            body: UpdateChannelBookmarkRequestToJSON(requestParameters['updateChannelBookmarkRequest']),
        };
    }
    async updateChannelBookmarkRaw(requestParameters, initOverrides) {
        const requestOptions = await this.updateChannelBookmarkRequestOpts(requestParameters);
        const response = await this.request(requestOptions, initOverrides);
        return new runtime.JSONApiResponse(response, (jsonValue) => UpdateChannelBookmarkResponseFromJSON(jsonValue));
    }
    async updateChannelBookmark(requestParameters, initOverrides) {
        const response = await this.updateChannelBookmarkRaw(requestParameters, initOverrides);
        return await response.value();
    }
    async updateChannelBookmarkSortOrderRequestOpts(requestParameters) {
        if (requestParameters['channelId'] == null) {
            throw new runtime.RequiredError('channelId', 'Required parameter "channelId" was null or undefined when calling updateChannelBookmarkSortOrder().');
        }
        if (requestParameters['bookmarkId'] == null) {
            throw new runtime.RequiredError('bookmarkId', 'Required parameter "bookmarkId" was null or undefined when calling updateChannelBookmarkSortOrder().');
        }
        if (requestParameters['body'] == null) {
            throw new runtime.RequiredError('body', 'Required parameter "body" was null or undefined when calling updateChannelBookmarkSortOrder().');
        }
        const queryParameters = {};
        const headerParameters = {};
        headerParameters['Content-Type'] = 'application/json';
        if (requestParameters['connectionId'] != null) {
            headerParameters['Connection-Id'] = String(requestParameters['connectionId']);
        }
        if (this.configuration && this.configuration.accessToken) {
            const token = this.configuration.accessToken;
            const tokenString = await token("bearerAuth", []);
            if (tokenString) {
                headerParameters["Authorization"] = `Bearer ${tokenString}`;
            }
        }
        let urlPath = `/api/v4/channels/{channel_id}/bookmarks/{bookmark_id}/sort_order`;
        urlPath = urlPath.replace('{channel_id}', encodeURIComponent(String(requestParameters['channelId'])));
        urlPath = urlPath.replace('{bookmark_id}', encodeURIComponent(String(requestParameters['bookmarkId'])));
        return {
            path: urlPath,
            method: 'POST',
            headers: headerParameters,
            query: queryParameters,
            body: requestParameters['body'],
        };
    }
    async updateChannelBookmarkSortOrderRaw(requestParameters, initOverrides) {
        const requestOptions = await this.updateChannelBookmarkSortOrderRequestOpts(requestParameters);
        const response = await this.request(requestOptions, initOverrides);
        return new runtime.JSONApiResponse(response, (jsonValue) => jsonValue.map(ChannelBookmarkWithFileInfoFromJSON));
    }
    async updateChannelBookmarkSortOrder(requestParameters, initOverrides) {
        const response = await this.updateChannelBookmarkSortOrderRaw(requestParameters, initOverrides);
        return await response.value();
    }
}
