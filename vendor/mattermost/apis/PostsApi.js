import * as runtime from '../runtime.js';
import { PostInfoFromJSON, } from '../models/PostInfo.js';
import { PostListFromJSON, } from '../models/PostList.js';
export class PostsApi extends runtime.BaseAPI {
    async getPostInfoRequestOpts(requestParameters) {
        if (requestParameters['postId'] == null) {
            throw new runtime.RequiredError('postId', 'Required parameter "postId" was null or undefined when calling getPostInfo().');
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
        let urlPath = `/api/v4/posts/{post_id}/info`;
        urlPath = urlPath.replace('{post_id}', encodeURIComponent(String(requestParameters['postId'])));
        return {
            path: urlPath,
            method: 'GET',
            headers: headerParameters,
            query: queryParameters,
        };
    }
    async getPostInfoRaw(requestParameters, initOverrides) {
        const requestOptions = await this.getPostInfoRequestOpts(requestParameters);
        const response = await this.request(requestOptions, initOverrides);
        return new runtime.JSONApiResponse(response, (jsonValue) => PostInfoFromJSON(jsonValue));
    }
    async getPostInfo(requestParameters, initOverrides) {
        const response = await this.getPostInfoRaw(requestParameters, initOverrides);
        return await response.value();
    }
    async getPostsForChannelRequestOpts(requestParameters) {
        if (requestParameters['channelId'] == null) {
            throw new runtime.RequiredError('channelId', 'Required parameter "channelId" was null or undefined when calling getPostsForChannel().');
        }
        const queryParameters = {};
        if (requestParameters['page'] != null) {
            queryParameters['page'] = requestParameters['page'];
        }
        if (requestParameters['perPage'] != null) {
            queryParameters['per_page'] = requestParameters['perPage'];
        }
        if (requestParameters['since'] != null) {
            queryParameters['since'] = requestParameters['since'];
        }
        if (requestParameters['before'] != null) {
            queryParameters['before'] = requestParameters['before'];
        }
        if (requestParameters['after'] != null) {
            queryParameters['after'] = requestParameters['after'];
        }
        if (requestParameters['includeDeleted'] != null) {
            queryParameters['include_deleted'] = requestParameters['includeDeleted'];
        }
        if (requestParameters['skipFetchThreads'] != null) {
            queryParameters['skipFetchThreads'] = requestParameters['skipFetchThreads'];
        }
        if (requestParameters['collapsedThreads'] != null) {
            queryParameters['collapsedThreads'] = requestParameters['collapsedThreads'];
        }
        if (requestParameters['collapsedThreadsExtended'] != null) {
            queryParameters['collapsedThreadsExtended'] = requestParameters['collapsedThreadsExtended'];
        }
        const headerParameters = {};
        if (this.configuration && this.configuration.accessToken) {
            const token = this.configuration.accessToken;
            const tokenString = await token("bearerAuth", []);
            if (tokenString) {
                headerParameters["Authorization"] = `Bearer ${tokenString}`;
            }
        }
        let urlPath = `/api/v4/channels/{channel_id}/posts`;
        urlPath = urlPath.replace('{channel_id}', encodeURIComponent(String(requestParameters['channelId'])));
        return {
            path: urlPath,
            method: 'GET',
            headers: headerParameters,
            query: queryParameters,
        };
    }
    async getPostsForChannelRaw(requestParameters, initOverrides) {
        const requestOptions = await this.getPostsForChannelRequestOpts(requestParameters);
        const response = await this.request(requestOptions, initOverrides);
        return new runtime.JSONApiResponse(response, (jsonValue) => PostListFromJSON(jsonValue));
    }
    async getPostsForChannel(requestParameters, initOverrides) {
        const response = await this.getPostsForChannelRaw(requestParameters, initOverrides);
        return await response.value();
    }
}
