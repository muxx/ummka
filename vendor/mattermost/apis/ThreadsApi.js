import * as runtime from '../runtime.js';
import { StatusOKFromJSON, } from '../models/StatusOK.js';
import { UserThreadFromJSON, } from '../models/UserThread.js';
import { UserThreadsFromJSON, } from '../models/UserThreads.js';
export class ThreadsApi extends runtime.BaseAPI {
    async getUserThreadRequestOpts(requestParameters) {
        if (requestParameters['userId'] == null) {
            throw new runtime.RequiredError('userId', 'Required parameter "userId" was null or undefined when calling getUserThread().');
        }
        if (requestParameters['teamId'] == null) {
            throw new runtime.RequiredError('teamId', 'Required parameter "teamId" was null or undefined when calling getUserThread().');
        }
        if (requestParameters['threadId'] == null) {
            throw new runtime.RequiredError('threadId', 'Required parameter "threadId" was null or undefined when calling getUserThread().');
        }
        const queryParameters = {};
        if (requestParameters['extended'] != null) {
            queryParameters['extended'] = requestParameters['extended'];
        }
        const headerParameters = {};
        if (this.configuration && this.configuration.accessToken) {
            const token = this.configuration.accessToken;
            const tokenString = await token("bearerAuth", []);
            if (tokenString) {
                headerParameters["Authorization"] = `Bearer ${tokenString}`;
            }
        }
        let urlPath = `/api/v4/users/{user_id}/teams/{team_id}/threads/{thread_id}`;
        urlPath = urlPath.replace('{user_id}', encodeURIComponent(String(requestParameters['userId'])));
        urlPath = urlPath.replace('{team_id}', encodeURIComponent(String(requestParameters['teamId'])));
        urlPath = urlPath.replace('{thread_id}', encodeURIComponent(String(requestParameters['threadId'])));
        return {
            path: urlPath,
            method: 'GET',
            headers: headerParameters,
            query: queryParameters,
        };
    }
    async getUserThreadRaw(requestParameters, initOverrides) {
        const requestOptions = await this.getUserThreadRequestOpts(requestParameters);
        const response = await this.request(requestOptions, initOverrides);
        return new runtime.JSONApiResponse(response, (jsonValue) => UserThreadFromJSON(jsonValue));
    }
    async getUserThread(requestParameters, initOverrides) {
        const response = await this.getUserThreadRaw(requestParameters, initOverrides);
        return await response.value();
    }
    async getUserThreadsRequestOpts(requestParameters) {
        if (requestParameters['userId'] == null) {
            throw new runtime.RequiredError('userId', 'Required parameter "userId" was null or undefined when calling getUserThreads().');
        }
        if (requestParameters['teamId'] == null) {
            throw new runtime.RequiredError('teamId', 'Required parameter "teamId" was null or undefined when calling getUserThreads().');
        }
        const queryParameters = {};
        if (requestParameters['since'] != null) {
            queryParameters['since'] = requestParameters['since'];
        }
        if (requestParameters['deleted'] != null) {
            queryParameters['deleted'] = requestParameters['deleted'];
        }
        if (requestParameters['extended'] != null) {
            queryParameters['extended'] = requestParameters['extended'];
        }
        if (requestParameters['perPage'] != null) {
            queryParameters['per_page'] = requestParameters['perPage'];
        }
        if (requestParameters['totalsOnly'] != null) {
            queryParameters['totalsOnly'] = requestParameters['totalsOnly'];
        }
        if (requestParameters['threadsOnly'] != null) {
            queryParameters['threadsOnly'] = requestParameters['threadsOnly'];
        }
        if (requestParameters['before'] != null) {
            queryParameters['before'] = requestParameters['before'];
        }
        if (requestParameters['after'] != null) {
            queryParameters['after'] = requestParameters['after'];
        }
        if (requestParameters['unread'] != null) {
            queryParameters['unread'] = requestParameters['unread'];
        }
        if (requestParameters['excludeDirect'] != null) {
            queryParameters['excludeDirect'] = requestParameters['excludeDirect'];
        }
        const headerParameters = {};
        if (this.configuration && this.configuration.accessToken) {
            const token = this.configuration.accessToken;
            const tokenString = await token("bearerAuth", []);
            if (tokenString) {
                headerParameters["Authorization"] = `Bearer ${tokenString}`;
            }
        }
        let urlPath = `/api/v4/users/{user_id}/teams/{team_id}/threads`;
        urlPath = urlPath.replace('{user_id}', encodeURIComponent(String(requestParameters['userId'])));
        urlPath = urlPath.replace('{team_id}', encodeURIComponent(String(requestParameters['teamId'])));
        return {
            path: urlPath,
            method: 'GET',
            headers: headerParameters,
            query: queryParameters,
        };
    }
    async getUserThreadsRaw(requestParameters, initOverrides) {
        const requestOptions = await this.getUserThreadsRequestOpts(requestParameters);
        const response = await this.request(requestOptions, initOverrides);
        return new runtime.JSONApiResponse(response, (jsonValue) => UserThreadsFromJSON(jsonValue));
    }
    async getUserThreads(requestParameters, initOverrides) {
        const response = await this.getUserThreadsRaw(requestParameters, initOverrides);
        return await response.value();
    }
    async setThreadUnreadByPostIdRequestOpts(requestParameters) {
        if (requestParameters['userId'] == null) {
            throw new runtime.RequiredError('userId', 'Required parameter "userId" was null or undefined when calling setThreadUnreadByPostId().');
        }
        if (requestParameters['teamId'] == null) {
            throw new runtime.RequiredError('teamId', 'Required parameter "teamId" was null or undefined when calling setThreadUnreadByPostId().');
        }
        if (requestParameters['threadId'] == null) {
            throw new runtime.RequiredError('threadId', 'Required parameter "threadId" was null or undefined when calling setThreadUnreadByPostId().');
        }
        if (requestParameters['postId'] == null) {
            throw new runtime.RequiredError('postId', 'Required parameter "postId" was null or undefined when calling setThreadUnreadByPostId().');
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
        let urlPath = `/api/v4/users/{user_id}/teams/{team_id}/threads/{thread_id}/set_unread/{post_id}`;
        urlPath = urlPath.replace('{user_id}', encodeURIComponent(String(requestParameters['userId'])));
        urlPath = urlPath.replace('{team_id}', encodeURIComponent(String(requestParameters['teamId'])));
        urlPath = urlPath.replace('{thread_id}', encodeURIComponent(String(requestParameters['threadId'])));
        urlPath = urlPath.replace('{post_id}', encodeURIComponent(String(requestParameters['postId'])));
        return {
            path: urlPath,
            method: 'POST',
            headers: headerParameters,
            query: queryParameters,
        };
    }
    async setThreadUnreadByPostIdRaw(requestParameters, initOverrides) {
        const requestOptions = await this.setThreadUnreadByPostIdRequestOpts(requestParameters);
        const response = await this.request(requestOptions, initOverrides);
        return new runtime.JSONApiResponse(response, (jsonValue) => UserThreadFromJSON(jsonValue));
    }
    async setThreadUnreadByPostId(requestParameters, initOverrides) {
        const response = await this.setThreadUnreadByPostIdRaw(requestParameters, initOverrides);
        return await response.value();
    }
    async startFollowingThreadRequestOpts(requestParameters) {
        if (requestParameters['userId'] == null) {
            throw new runtime.RequiredError('userId', 'Required parameter "userId" was null or undefined when calling startFollowingThread().');
        }
        if (requestParameters['teamId'] == null) {
            throw new runtime.RequiredError('teamId', 'Required parameter "teamId" was null or undefined when calling startFollowingThread().');
        }
        if (requestParameters['threadId'] == null) {
            throw new runtime.RequiredError('threadId', 'Required parameter "threadId" was null or undefined when calling startFollowingThread().');
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
        let urlPath = `/api/v4/users/{user_id}/teams/{team_id}/threads/{thread_id}/following`;
        urlPath = urlPath.replace('{user_id}', encodeURIComponent(String(requestParameters['userId'])));
        urlPath = urlPath.replace('{team_id}', encodeURIComponent(String(requestParameters['teamId'])));
        urlPath = urlPath.replace('{thread_id}', encodeURIComponent(String(requestParameters['threadId'])));
        return {
            path: urlPath,
            method: 'PUT',
            headers: headerParameters,
            query: queryParameters,
        };
    }
    async startFollowingThreadRaw(requestParameters, initOverrides) {
        const requestOptions = await this.startFollowingThreadRequestOpts(requestParameters);
        const response = await this.request(requestOptions, initOverrides);
        return new runtime.JSONApiResponse(response, (jsonValue) => StatusOKFromJSON(jsonValue));
    }
    async startFollowingThread(requestParameters, initOverrides) {
        const response = await this.startFollowingThreadRaw(requestParameters, initOverrides);
        return await response.value();
    }
    async stopFollowingThreadRequestOpts(requestParameters) {
        if (requestParameters['userId'] == null) {
            throw new runtime.RequiredError('userId', 'Required parameter "userId" was null or undefined when calling stopFollowingThread().');
        }
        if (requestParameters['teamId'] == null) {
            throw new runtime.RequiredError('teamId', 'Required parameter "teamId" was null or undefined when calling stopFollowingThread().');
        }
        if (requestParameters['threadId'] == null) {
            throw new runtime.RequiredError('threadId', 'Required parameter "threadId" was null or undefined when calling stopFollowingThread().');
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
        let urlPath = `/api/v4/users/{user_id}/teams/{team_id}/threads/{thread_id}/following`;
        urlPath = urlPath.replace('{user_id}', encodeURIComponent(String(requestParameters['userId'])));
        urlPath = urlPath.replace('{team_id}', encodeURIComponent(String(requestParameters['teamId'])));
        urlPath = urlPath.replace('{thread_id}', encodeURIComponent(String(requestParameters['threadId'])));
        return {
            path: urlPath,
            method: 'DELETE',
            headers: headerParameters,
            query: queryParameters,
        };
    }
    async stopFollowingThreadRaw(requestParameters, initOverrides) {
        const requestOptions = await this.stopFollowingThreadRequestOpts(requestParameters);
        const response = await this.request(requestOptions, initOverrides);
        return new runtime.JSONApiResponse(response, (jsonValue) => StatusOKFromJSON(jsonValue));
    }
    async stopFollowingThread(requestParameters, initOverrides) {
        const response = await this.stopFollowingThreadRaw(requestParameters, initOverrides);
        return await response.value();
    }
    async updateThreadReadForUserRequestOpts(requestParameters) {
        if (requestParameters['userId'] == null) {
            throw new runtime.RequiredError('userId', 'Required parameter "userId" was null or undefined when calling updateThreadReadForUser().');
        }
        if (requestParameters['teamId'] == null) {
            throw new runtime.RequiredError('teamId', 'Required parameter "teamId" was null or undefined when calling updateThreadReadForUser().');
        }
        if (requestParameters['threadId'] == null) {
            throw new runtime.RequiredError('threadId', 'Required parameter "threadId" was null or undefined when calling updateThreadReadForUser().');
        }
        if (requestParameters['timestamp'] == null) {
            throw new runtime.RequiredError('timestamp', 'Required parameter "timestamp" was null or undefined when calling updateThreadReadForUser().');
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
        let urlPath = `/api/v4/users/{user_id}/teams/{team_id}/threads/{thread_id}/read/{timestamp}`;
        urlPath = urlPath.replace('{user_id}', encodeURIComponent(String(requestParameters['userId'])));
        urlPath = urlPath.replace('{team_id}', encodeURIComponent(String(requestParameters['teamId'])));
        urlPath = urlPath.replace('{thread_id}', encodeURIComponent(String(requestParameters['threadId'])));
        urlPath = urlPath.replace('{timestamp}', encodeURIComponent(String(requestParameters['timestamp'])));
        return {
            path: urlPath,
            method: 'PUT',
            headers: headerParameters,
            query: queryParameters,
        };
    }
    async updateThreadReadForUserRaw(requestParameters, initOverrides) {
        const requestOptions = await this.updateThreadReadForUserRequestOpts(requestParameters);
        const response = await this.request(requestOptions, initOverrides);
        return new runtime.JSONApiResponse(response, (jsonValue) => UserThreadFromJSON(jsonValue));
    }
    async updateThreadReadForUser(requestParameters, initOverrides) {
        const response = await this.updateThreadReadForUserRaw(requestParameters, initOverrides);
        return await response.value();
    }
    async updateThreadsReadForUserRequestOpts(requestParameters) {
        if (requestParameters['userId'] == null) {
            throw new runtime.RequiredError('userId', 'Required parameter "userId" was null or undefined when calling updateThreadsReadForUser().');
        }
        if (requestParameters['teamId'] == null) {
            throw new runtime.RequiredError('teamId', 'Required parameter "teamId" was null or undefined when calling updateThreadsReadForUser().');
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
        let urlPath = `/api/v4/users/{user_id}/teams/{team_id}/threads/read`;
        urlPath = urlPath.replace('{user_id}', encodeURIComponent(String(requestParameters['userId'])));
        urlPath = urlPath.replace('{team_id}', encodeURIComponent(String(requestParameters['teamId'])));
        return {
            path: urlPath,
            method: 'PUT',
            headers: headerParameters,
            query: queryParameters,
        };
    }
    async updateThreadsReadForUserRaw(requestParameters, initOverrides) {
        const requestOptions = await this.updateThreadsReadForUserRequestOpts(requestParameters);
        const response = await this.request(requestOptions, initOverrides);
        return new runtime.JSONApiResponse(response, (jsonValue) => StatusOKFromJSON(jsonValue));
    }
    async updateThreadsReadForUser(requestParameters, initOverrides) {
        const response = await this.updateThreadsReadForUserRaw(requestParameters, initOverrides);
        return await response.value();
    }
}
