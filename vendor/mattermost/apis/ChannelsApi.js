import * as runtime from '../runtime.js';
import { ChannelFromJSON, } from '../models/Channel.js';
import { ChannelMemberFromJSON, } from '../models/ChannelMember.js';
export class ChannelsApi extends runtime.BaseAPI {
    async getChannelMembersForUserRequestOpts(requestParameters) {
        if (requestParameters['userId'] == null) {
            throw new runtime.RequiredError('userId', 'Required parameter "userId" was null or undefined when calling getChannelMembersForUser().');
        }
        if (requestParameters['teamId'] == null) {
            throw new runtime.RequiredError('teamId', 'Required parameter "teamId" was null or undefined when calling getChannelMembersForUser().');
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
        let urlPath = `/api/v4/users/{user_id}/teams/{team_id}/channels/members`;
        urlPath = urlPath.replace('{user_id}', encodeURIComponent(String(requestParameters['userId'])));
        urlPath = urlPath.replace('{team_id}', encodeURIComponent(String(requestParameters['teamId'])));
        return {
            path: urlPath,
            method: 'GET',
            headers: headerParameters,
            query: queryParameters,
        };
    }
    async getChannelMembersForUserRaw(requestParameters, initOverrides) {
        const requestOptions = await this.getChannelMembersForUserRequestOpts(requestParameters);
        const response = await this.request(requestOptions, initOverrides);
        return new runtime.JSONApiResponse(response, (jsonValue) => jsonValue.map(ChannelMemberFromJSON));
    }
    async getChannelMembersForUser(requestParameters, initOverrides) {
        const response = await this.getChannelMembersForUserRaw(requestParameters, initOverrides);
        return await response.value();
    }
    async getChannelsForTeamForUserRequestOpts(requestParameters) {
        if (requestParameters['userId'] == null) {
            throw new runtime.RequiredError('userId', 'Required parameter "userId" was null or undefined when calling getChannelsForTeamForUser().');
        }
        if (requestParameters['teamId'] == null) {
            throw new runtime.RequiredError('teamId', 'Required parameter "teamId" was null or undefined when calling getChannelsForTeamForUser().');
        }
        const queryParameters = {};
        if (requestParameters['includeDeleted'] != null) {
            queryParameters['include_deleted'] = requestParameters['includeDeleted'];
        }
        if (requestParameters['lastDeleteAt'] != null) {
            queryParameters['last_delete_at'] = requestParameters['lastDeleteAt'];
        }
        const headerParameters = {};
        if (this.configuration && this.configuration.accessToken) {
            const token = this.configuration.accessToken;
            const tokenString = await token("bearerAuth", []);
            if (tokenString) {
                headerParameters["Authorization"] = `Bearer ${tokenString}`;
            }
        }
        let urlPath = `/api/v4/users/{user_id}/teams/{team_id}/channels`;
        urlPath = urlPath.replace('{user_id}', encodeURIComponent(String(requestParameters['userId'])));
        urlPath = urlPath.replace('{team_id}', encodeURIComponent(String(requestParameters['teamId'])));
        return {
            path: urlPath,
            method: 'GET',
            headers: headerParameters,
            query: queryParameters,
        };
    }
    async getChannelsForTeamForUserRaw(requestParameters, initOverrides) {
        const requestOptions = await this.getChannelsForTeamForUserRequestOpts(requestParameters);
        const response = await this.request(requestOptions, initOverrides);
        return new runtime.JSONApiResponse(response, (jsonValue) => jsonValue.map(ChannelFromJSON));
    }
    async getChannelsForTeamForUser(requestParameters, initOverrides) {
        const response = await this.getChannelsForTeamForUserRaw(requestParameters, initOverrides);
        return await response.value();
    }
}
