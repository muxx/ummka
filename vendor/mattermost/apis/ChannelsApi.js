import * as runtime from '../runtime.js';
import { ChannelFromJSON, } from '../models/Channel.js';
import { ChannelMemberFromJSON, } from '../models/ChannelMember.js';
import { MarkChannelsReadForUser200ResponseFromJSON, } from '../models/MarkChannelsReadForUser200Response.js';
import { OrderedSidebarCategoriesFromJSON, } from '../models/OrderedSidebarCategories.js';
import { ViewChannel200ResponseFromJSON, } from '../models/ViewChannel200Response.js';
import { ViewChannelRequestToJSON, } from '../models/ViewChannelRequest.js';
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
    async getSidebarCategoriesForTeamForUserRequestOpts(requestParameters) {
        if (requestParameters['teamId'] == null) {
            throw new runtime.RequiredError('teamId', 'Required parameter "teamId" was null or undefined when calling getSidebarCategoriesForTeamForUser().');
        }
        if (requestParameters['userId'] == null) {
            throw new runtime.RequiredError('userId', 'Required parameter "userId" was null or undefined when calling getSidebarCategoriesForTeamForUser().');
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
        let urlPath = `/api/v4/users/{user_id}/teams/{team_id}/channels/categories`;
        urlPath = urlPath.replace('{team_id}', encodeURIComponent(String(requestParameters['teamId'])));
        urlPath = urlPath.replace('{user_id}', encodeURIComponent(String(requestParameters['userId'])));
        return {
            path: urlPath,
            method: 'GET',
            headers: headerParameters,
            query: queryParameters,
        };
    }
    async getSidebarCategoriesForTeamForUserRaw(requestParameters, initOverrides) {
        const requestOptions = await this.getSidebarCategoriesForTeamForUserRequestOpts(requestParameters);
        const response = await this.request(requestOptions, initOverrides);
        return new runtime.JSONApiResponse(response, (jsonValue) => OrderedSidebarCategoriesFromJSON(jsonValue));
    }
    async getSidebarCategoriesForTeamForUser(requestParameters, initOverrides) {
        const response = await this.getSidebarCategoriesForTeamForUserRaw(requestParameters, initOverrides);
        return await response.value();
    }
    async markChannelsReadForUserRequestOpts(requestParameters) {
        if (requestParameters['userId'] == null) {
            throw new runtime.RequiredError('userId', 'Required parameter "userId" was null or undefined when calling markChannelsReadForUser().');
        }
        if (requestParameters['requestBody'] == null) {
            throw new runtime.RequiredError('requestBody', 'Required parameter "requestBody" was null or undefined when calling markChannelsReadForUser().');
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
        let urlPath = `/api/v4/channels/members/{user_id}/mark_read`;
        urlPath = urlPath.replace('{user_id}', encodeURIComponent(String(requestParameters['userId'])));
        return {
            path: urlPath,
            method: 'POST',
            headers: headerParameters,
            query: queryParameters,
            body: requestParameters['requestBody'],
        };
    }
    async markChannelsReadForUserRaw(requestParameters, initOverrides) {
        const requestOptions = await this.markChannelsReadForUserRequestOpts(requestParameters);
        const response = await this.request(requestOptions, initOverrides);
        return new runtime.JSONApiResponse(response, (jsonValue) => MarkChannelsReadForUser200ResponseFromJSON(jsonValue));
    }
    async markChannelsReadForUser(requestParameters, initOverrides) {
        const response = await this.markChannelsReadForUserRaw(requestParameters, initOverrides);
        return await response.value();
    }
    async viewChannelRequestOpts(requestParameters) {
        if (requestParameters['userId'] == null) {
            throw new runtime.RequiredError('userId', 'Required parameter "userId" was null or undefined when calling viewChannel().');
        }
        if (requestParameters['viewChannelRequest'] == null) {
            throw new runtime.RequiredError('viewChannelRequest', 'Required parameter "viewChannelRequest" was null or undefined when calling viewChannel().');
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
        let urlPath = `/api/v4/channels/members/{user_id}/view`;
        urlPath = urlPath.replace('{user_id}', encodeURIComponent(String(requestParameters['userId'])));
        return {
            path: urlPath,
            method: 'POST',
            headers: headerParameters,
            query: queryParameters,
            body: ViewChannelRequestToJSON(requestParameters['viewChannelRequest']),
        };
    }
    async viewChannelRaw(requestParameters, initOverrides) {
        const requestOptions = await this.viewChannelRequestOpts(requestParameters);
        const response = await this.request(requestOptions, initOverrides);
        return new runtime.JSONApiResponse(response, (jsonValue) => ViewChannel200ResponseFromJSON(jsonValue));
    }
    async viewChannel(requestParameters, initOverrides) {
        const response = await this.viewChannelRaw(requestParameters, initOverrides);
        return await response.value();
    }
}
