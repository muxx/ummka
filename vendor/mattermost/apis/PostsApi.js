import * as runtime from '../runtime.js';
import { ChannelUnreadAtFromJSON, } from '../models/ChannelUnreadAt.js';
import { CreatePostRequestToJSON, } from '../models/CreatePostRequest.js';
import { PatchPostRequestToJSON, } from '../models/PatchPostRequest.js';
import { PostFromJSON, } from '../models/Post.js';
import { PostInfoFromJSON, } from '../models/PostInfo.js';
import { PostListFromJSON, } from '../models/PostList.js';
import { SetPostUnreadRequestToJSON, } from '../models/SetPostUnreadRequest.js';
import { StatusOKFromJSON, } from '../models/StatusOK.js';
export class PostsApi extends runtime.BaseAPI {
    async createPostRequestOpts(requestParameters) {
        if (requestParameters['createPostRequest'] == null) {
            throw new runtime.RequiredError('createPostRequest', 'Required parameter "createPostRequest" was null or undefined when calling createPost().');
        }
        const queryParameters = {};
        if (requestParameters['setOnline'] != null) {
            queryParameters['set_online'] = requestParameters['setOnline'];
        }
        const headerParameters = {};
        headerParameters['Content-Type'] = 'application/json';
        if (this.configuration && this.configuration.accessToken) {
            const token = this.configuration.accessToken;
            const tokenString = await token("bearerAuth", []);
            if (tokenString) {
                headerParameters["Authorization"] = `Bearer ${tokenString}`;
            }
        }
        let urlPath = `/api/v4/posts`;
        return {
            path: urlPath,
            method: 'POST',
            headers: headerParameters,
            query: queryParameters,
            body: CreatePostRequestToJSON(requestParameters['createPostRequest']),
        };
    }
    async createPostRaw(requestParameters, initOverrides) {
        const requestOptions = await this.createPostRequestOpts(requestParameters);
        const response = await this.request(requestOptions, initOverrides);
        return new runtime.JSONApiResponse(response, (jsonValue) => PostFromJSON(jsonValue));
    }
    async createPost(requestParameters, initOverrides) {
        const response = await this.createPostRaw(requestParameters, initOverrides);
        return await response.value();
    }
    async deletePostRequestOpts(requestParameters) {
        if (requestParameters['postId'] == null) {
            throw new runtime.RequiredError('postId', 'Required parameter "postId" was null or undefined when calling deletePost().');
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
        let urlPath = `/api/v4/posts/{post_id}`;
        urlPath = urlPath.replace('{post_id}', encodeURIComponent(String(requestParameters['postId'])));
        return {
            path: urlPath,
            method: 'DELETE',
            headers: headerParameters,
            query: queryParameters,
        };
    }
    async deletePostRaw(requestParameters, initOverrides) {
        const requestOptions = await this.deletePostRequestOpts(requestParameters);
        const response = await this.request(requestOptions, initOverrides);
        return new runtime.JSONApiResponse(response, (jsonValue) => StatusOKFromJSON(jsonValue));
    }
    async deletePost(requestParameters, initOverrides) {
        const response = await this.deletePostRaw(requestParameters, initOverrides);
        return await response.value();
    }
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
    async getPostThreadRequestOpts(requestParameters) {
        if (requestParameters['postId'] == null) {
            throw new runtime.RequiredError('postId', 'Required parameter "postId" was null or undefined when calling getPostThread().');
        }
        const queryParameters = {};
        if (requestParameters['perPage'] != null) {
            queryParameters['perPage'] = requestParameters['perPage'];
        }
        if (requestParameters['fromPost'] != null) {
            queryParameters['fromPost'] = requestParameters['fromPost'];
        }
        if (requestParameters['fromCreateAt'] != null) {
            queryParameters['fromCreateAt'] = requestParameters['fromCreateAt'];
        }
        if (requestParameters['fromUpdateAt'] != null) {
            queryParameters['fromUpdateAt'] = requestParameters['fromUpdateAt'];
        }
        if (requestParameters['direction'] != null) {
            queryParameters['direction'] = requestParameters['direction'];
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
        if (requestParameters['updatesOnly'] != null) {
            queryParameters['updatesOnly'] = requestParameters['updatesOnly'];
        }
        const headerParameters = {};
        if (this.configuration && this.configuration.accessToken) {
            const token = this.configuration.accessToken;
            const tokenString = await token("bearerAuth", []);
            if (tokenString) {
                headerParameters["Authorization"] = `Bearer ${tokenString}`;
            }
        }
        let urlPath = `/api/v4/posts/{post_id}/thread`;
        urlPath = urlPath.replace('{post_id}', encodeURIComponent(String(requestParameters['postId'])));
        return {
            path: urlPath,
            method: 'GET',
            headers: headerParameters,
            query: queryParameters,
        };
    }
    async getPostThreadRaw(requestParameters, initOverrides) {
        const requestOptions = await this.getPostThreadRequestOpts(requestParameters);
        const response = await this.request(requestOptions, initOverrides);
        return new runtime.JSONApiResponse(response, (jsonValue) => PostListFromJSON(jsonValue));
    }
    async getPostThread(requestParameters, initOverrides) {
        const response = await this.getPostThreadRaw(requestParameters, initOverrides);
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
    async patchPostRequestOpts(requestParameters) {
        if (requestParameters['postId'] == null) {
            throw new runtime.RequiredError('postId', 'Required parameter "postId" was null or undefined when calling patchPost().');
        }
        if (requestParameters['patchPostRequest'] == null) {
            throw new runtime.RequiredError('patchPostRequest', 'Required parameter "patchPostRequest" was null or undefined when calling patchPost().');
        }
        const queryParameters = {};
        const headerParameters = {};
        headerParameters['Content-Type'] = 'application/json';
        if (this.configuration && this.configuration.accessToken) {
            const token = this.configuration.accessToken;
            const tokenString = await token("bearerAuth", []);
            if (tokenString) {
                headerParameters["Authorization"] = `Bearer ${tokenString}`;
            }
        }
        let urlPath = `/api/v4/posts/{post_id}/patch`;
        urlPath = urlPath.replace('{post_id}', encodeURIComponent(String(requestParameters['postId'])));
        return {
            path: urlPath,
            method: 'PUT',
            headers: headerParameters,
            query: queryParameters,
            body: PatchPostRequestToJSON(requestParameters['patchPostRequest']),
        };
    }
    async patchPostRaw(requestParameters, initOverrides) {
        const requestOptions = await this.patchPostRequestOpts(requestParameters);
        const response = await this.request(requestOptions, initOverrides);
        return new runtime.JSONApiResponse(response, (jsonValue) => PostFromJSON(jsonValue));
    }
    async patchPost(requestParameters, initOverrides) {
        const response = await this.patchPostRaw(requestParameters, initOverrides);
        return await response.value();
    }
    async setPostUnreadRequestOpts(requestParameters) {
        if (requestParameters['userId'] == null) {
            throw new runtime.RequiredError('userId', 'Required parameter "userId" was null or undefined when calling setPostUnread().');
        }
        if (requestParameters['postId'] == null) {
            throw new runtime.RequiredError('postId', 'Required parameter "postId" was null or undefined when calling setPostUnread().');
        }
        if (requestParameters['setPostUnreadRequest'] == null) {
            throw new runtime.RequiredError('setPostUnreadRequest', 'Required parameter "setPostUnreadRequest" was null or undefined when calling setPostUnread().');
        }
        const queryParameters = {};
        const headerParameters = {};
        headerParameters['Content-Type'] = 'application/json';
        if (this.configuration && this.configuration.accessToken) {
            const token = this.configuration.accessToken;
            const tokenString = await token("bearerAuth", []);
            if (tokenString) {
                headerParameters["Authorization"] = `Bearer ${tokenString}`;
            }
        }
        let urlPath = `/api/v4/users/{user_id}/posts/{post_id}/set_unread`;
        urlPath = urlPath.replace('{user_id}', encodeURIComponent(String(requestParameters['userId'])));
        urlPath = urlPath.replace('{post_id}', encodeURIComponent(String(requestParameters['postId'])));
        return {
            path: urlPath,
            method: 'POST',
            headers: headerParameters,
            query: queryParameters,
            body: SetPostUnreadRequestToJSON(requestParameters['setPostUnreadRequest']),
        };
    }
    async setPostUnreadRaw(requestParameters, initOverrides) {
        const requestOptions = await this.setPostUnreadRequestOpts(requestParameters);
        const response = await this.request(requestOptions, initOverrides);
        return new runtime.JSONApiResponse(response, (jsonValue) => ChannelUnreadAtFromJSON(jsonValue));
    }
    async setPostUnread(requestParameters, initOverrides) {
        const response = await this.setPostUnreadRaw(requestParameters, initOverrides);
        return await response.value();
    }
}
