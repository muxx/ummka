import * as runtime from '../runtime.js';
import { StatusOKFromJSON, } from '../models/StatusOK.js';
export class ThreadsApi extends runtime.BaseAPI {
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
}
