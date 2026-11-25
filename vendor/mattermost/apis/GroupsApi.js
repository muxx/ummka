import * as runtime from '../runtime.js';
import { GetGroupsAssociatedToChannelsByTeam200ResponseFromJSON, } from '../models/GetGroupsAssociatedToChannelsByTeam200Response.js';
import { GetGroupsByTeam200ResponseFromJSON, } from '../models/GetGroupsByTeam200Response.js';
import { GroupFromJSON, } from '../models/Group.js';
export class GroupsApi extends runtime.BaseAPI {
    async getGroupsRequestOpts(requestParameters) {
        const queryParameters = {};
        if (requestParameters['page'] != null) {
            queryParameters['page'] = requestParameters['page'];
        }
        if (requestParameters['perPage'] != null) {
            queryParameters['per_page'] = requestParameters['perPage'];
        }
        if (requestParameters['q'] != null) {
            queryParameters['q'] = requestParameters['q'];
        }
        if (requestParameters['includeMemberCount'] != null) {
            queryParameters['include_member_count'] = requestParameters['includeMemberCount'];
        }
        if (requestParameters['notAssociatedToTeam'] != null) {
            queryParameters['not_associated_to_team'] = requestParameters['notAssociatedToTeam'];
        }
        if (requestParameters['notAssociatedToChannel'] != null) {
            queryParameters['not_associated_to_channel'] = requestParameters['notAssociatedToChannel'];
        }
        if (requestParameters['since'] != null) {
            queryParameters['since'] = requestParameters['since'];
        }
        if (requestParameters['filterAllowReference'] != null) {
            queryParameters['filter_allow_reference'] = requestParameters['filterAllowReference'];
        }
        const headerParameters = {};
        if (this.configuration && this.configuration.accessToken) {
            const token = this.configuration.accessToken;
            const tokenString = await token("bearerAuth", []);
            if (tokenString) {
                headerParameters["Authorization"] = `Bearer ${tokenString}`;
            }
        }
        let urlPath = `/api/v4/groups`;
        return {
            path: urlPath,
            method: 'GET',
            headers: headerParameters,
            query: queryParameters,
        };
    }
    async getGroupsRaw(requestParameters, initOverrides) {
        const requestOptions = await this.getGroupsRequestOpts(requestParameters);
        const response = await this.request(requestOptions, initOverrides);
        return new runtime.JSONApiResponse(response, (jsonValue) => jsonValue.map(GroupFromJSON));
    }
    async getGroups(requestParameters = {}, initOverrides) {
        const response = await this.getGroupsRaw(requestParameters, initOverrides);
        return await response.value();
    }
    async getGroupsAssociatedToChannelsByTeamRequestOpts(requestParameters) {
        if (requestParameters['teamId'] == null) {
            throw new runtime.RequiredError('teamId', 'Required parameter "teamId" was null or undefined when calling getGroupsAssociatedToChannelsByTeam().');
        }
        const queryParameters = {};
        if (requestParameters['page'] != null) {
            queryParameters['page'] = requestParameters['page'];
        }
        if (requestParameters['perPage'] != null) {
            queryParameters['per_page'] = requestParameters['perPage'];
        }
        if (requestParameters['filterAllowReference'] != null) {
            queryParameters['filter_allow_reference'] = requestParameters['filterAllowReference'];
        }
        if (requestParameters['includeMemberCount'] != null) {
            queryParameters['include_member_count'] = requestParameters['includeMemberCount'];
        }
        if (requestParameters['paginate'] != null) {
            queryParameters['paginate'] = requestParameters['paginate'];
        }
        if (requestParameters['q'] != null) {
            queryParameters['q'] = requestParameters['q'];
        }
        const headerParameters = {};
        if (this.configuration && this.configuration.accessToken) {
            const token = this.configuration.accessToken;
            const tokenString = await token("bearerAuth", []);
            if (tokenString) {
                headerParameters["Authorization"] = `Bearer ${tokenString}`;
            }
        }
        let urlPath = `/api/v4/teams/{team_id}/groups_by_channels`;
        urlPath = urlPath.replace('{team_id}', encodeURIComponent(String(requestParameters['teamId'])));
        return {
            path: urlPath,
            method: 'GET',
            headers: headerParameters,
            query: queryParameters,
        };
    }
    async getGroupsAssociatedToChannelsByTeamRaw(requestParameters, initOverrides) {
        const requestOptions = await this.getGroupsAssociatedToChannelsByTeamRequestOpts(requestParameters);
        const response = await this.request(requestOptions, initOverrides);
        return new runtime.JSONApiResponse(response, (jsonValue) => GetGroupsAssociatedToChannelsByTeam200ResponseFromJSON(jsonValue));
    }
    async getGroupsAssociatedToChannelsByTeam(requestParameters, initOverrides) {
        const response = await this.getGroupsAssociatedToChannelsByTeamRaw(requestParameters, initOverrides);
        return await response.value();
    }
    async getGroupsByTeamRequestOpts(requestParameters) {
        if (requestParameters['teamId'] == null) {
            throw new runtime.RequiredError('teamId', 'Required parameter "teamId" was null or undefined when calling getGroupsByTeam().');
        }
        const queryParameters = {};
        if (requestParameters['page'] != null) {
            queryParameters['page'] = requestParameters['page'];
        }
        if (requestParameters['perPage'] != null) {
            queryParameters['per_page'] = requestParameters['perPage'];
        }
        if (requestParameters['filterAllowReference'] != null) {
            queryParameters['filter_allow_reference'] = requestParameters['filterAllowReference'];
        }
        if (requestParameters['includeMemberCount'] != null) {
            queryParameters['include_member_count'] = requestParameters['includeMemberCount'];
        }
        if (requestParameters['paginate'] != null) {
            queryParameters['paginate'] = requestParameters['paginate'];
        }
        if (requestParameters['q'] != null) {
            queryParameters['q'] = requestParameters['q'];
        }
        const headerParameters = {};
        if (this.configuration && this.configuration.accessToken) {
            const token = this.configuration.accessToken;
            const tokenString = await token("bearerAuth", []);
            if (tokenString) {
                headerParameters["Authorization"] = `Bearer ${tokenString}`;
            }
        }
        let urlPath = `/api/v4/teams/{team_id}/groups`;
        urlPath = urlPath.replace('{team_id}', encodeURIComponent(String(requestParameters['teamId'])));
        return {
            path: urlPath,
            method: 'GET',
            headers: headerParameters,
            query: queryParameters,
        };
    }
    async getGroupsByTeamRaw(requestParameters, initOverrides) {
        const requestOptions = await this.getGroupsByTeamRequestOpts(requestParameters);
        const response = await this.request(requestOptions, initOverrides);
        return new runtime.JSONApiResponse(response, (jsonValue) => GetGroupsByTeam200ResponseFromJSON(jsonValue));
    }
    async getGroupsByTeam(requestParameters, initOverrides) {
        const response = await this.getGroupsByTeamRaw(requestParameters, initOverrides);
        return await response.value();
    }
}
