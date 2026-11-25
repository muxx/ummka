import * as runtime from '../runtime.js';
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
}
