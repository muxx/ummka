import * as runtime from '../runtime.js';
import { AddChannelMemberRequestToJSON, } from '../models/AddChannelMemberRequest.js';
import { ChannelFromJSON, } from '../models/Channel.js';
import { ChannelMemberFromJSON, } from '../models/ChannelMember.js';
import { ChannelMemberCountByGroupFromJSON, } from '../models/ChannelMemberCountByGroup.js';
import { ChannelNotifyPropsToJSON, } from '../models/ChannelNotifyProps.js';
import { ChannelStatsFromJSON, } from '../models/ChannelStats.js';
import { MarkChannelsReadForUser200ResponseFromJSON, } from '../models/MarkChannelsReadForUser200Response.js';
import { OrderedSidebarCategoriesFromJSON, } from '../models/OrderedSidebarCategories.js';
import { PostListFromJSON, } from '../models/PostList.js';
import { SidebarCategoryWithChannelsFromJSON, SidebarCategoryWithChannelsToJSON, } from '../models/SidebarCategoryWithChannels.js';
import { StatusOKFromJSON, } from '../models/StatusOK.js';
import { ViewChannel200ResponseFromJSON, } from '../models/ViewChannel200Response.js';
import { ViewChannelRequestToJSON, } from '../models/ViewChannelRequest.js';
export class ChannelsApi extends runtime.BaseAPI {
    async addChannelMemberRequestOpts(requestParameters) {
        if (requestParameters['channelId'] == null) {
            throw new runtime.RequiredError('channelId', 'Required parameter "channelId" was null or undefined when calling addChannelMember().');
        }
        if (requestParameters['addChannelMemberRequest'] == null) {
            throw new runtime.RequiredError('addChannelMemberRequest', 'Required parameter "addChannelMemberRequest" was null or undefined when calling addChannelMember().');
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
        let urlPath = `/api/v4/channels/{channel_id}/members`;
        urlPath = urlPath.replace('{channel_id}', encodeURIComponent(String(requestParameters['channelId'])));
        return {
            path: urlPath,
            method: 'POST',
            headers: headerParameters,
            query: queryParameters,
            body: AddChannelMemberRequestToJSON(requestParameters['addChannelMemberRequest']),
        };
    }
    async addChannelMemberRaw(requestParameters, initOverrides) {
        const requestOptions = await this.addChannelMemberRequestOpts(requestParameters);
        const response = await this.request(requestOptions, initOverrides);
        return new runtime.JSONApiResponse(response, (jsonValue) => ChannelMemberFromJSON(jsonValue));
    }
    async addChannelMember(requestParameters, initOverrides) {
        const response = await this.addChannelMemberRaw(requestParameters, initOverrides);
        return await response.value();
    }
    async createSidebarCategoryForTeamForUserRequestOpts(requestParameters) {
        if (requestParameters['teamId'] == null) {
            throw new runtime.RequiredError('teamId', 'Required parameter "teamId" was null or undefined when calling createSidebarCategoryForTeamForUser().');
        }
        if (requestParameters['userId'] == null) {
            throw new runtime.RequiredError('userId', 'Required parameter "userId" was null or undefined when calling createSidebarCategoryForTeamForUser().');
        }
        if (requestParameters['sidebarCategoryWithChannels'] == null) {
            throw new runtime.RequiredError('sidebarCategoryWithChannels', 'Required parameter "sidebarCategoryWithChannels" was null or undefined when calling createSidebarCategoryForTeamForUser().');
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
        let urlPath = `/api/v4/users/{user_id}/teams/{team_id}/channels/categories`;
        urlPath = urlPath.replace('{team_id}', encodeURIComponent(String(requestParameters['teamId'])));
        urlPath = urlPath.replace('{user_id}', encodeURIComponent(String(requestParameters['userId'])));
        return {
            path: urlPath,
            method: 'POST',
            headers: headerParameters,
            query: queryParameters,
            body: SidebarCategoryWithChannelsToJSON(requestParameters['sidebarCategoryWithChannels']),
        };
    }
    async createSidebarCategoryForTeamForUserRaw(requestParameters, initOverrides) {
        const requestOptions = await this.createSidebarCategoryForTeamForUserRequestOpts(requestParameters);
        const response = await this.request(requestOptions, initOverrides);
        return new runtime.JSONApiResponse(response, (jsonValue) => SidebarCategoryWithChannelsFromJSON(jsonValue));
    }
    async createSidebarCategoryForTeamForUser(requestParameters, initOverrides) {
        const response = await this.createSidebarCategoryForTeamForUserRaw(requestParameters, initOverrides);
        return await response.value();
    }
    async getChannelRequestOpts(requestParameters) {
        if (requestParameters['channelId'] == null) {
            throw new runtime.RequiredError('channelId', 'Required parameter "channelId" was null or undefined when calling getChannel().');
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
        let urlPath = `/api/v4/channels/{channel_id}`;
        urlPath = urlPath.replace('{channel_id}', encodeURIComponent(String(requestParameters['channelId'])));
        return {
            path: urlPath,
            method: 'GET',
            headers: headerParameters,
            query: queryParameters,
        };
    }
    async getChannelRaw(requestParameters, initOverrides) {
        const requestOptions = await this.getChannelRequestOpts(requestParameters);
        const response = await this.request(requestOptions, initOverrides);
        return new runtime.JSONApiResponse(response, (jsonValue) => ChannelFromJSON(jsonValue));
    }
    async getChannel(requestParameters, initOverrides) {
        const response = await this.getChannelRaw(requestParameters, initOverrides);
        return await response.value();
    }
    async getChannelMemberRequestOpts(requestParameters) {
        if (requestParameters['channelId'] == null) {
            throw new runtime.RequiredError('channelId', 'Required parameter "channelId" was null or undefined when calling getChannelMember().');
        }
        if (requestParameters['userId'] == null) {
            throw new runtime.RequiredError('userId', 'Required parameter "userId" was null or undefined when calling getChannelMember().');
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
        let urlPath = `/api/v4/channels/{channel_id}/members/{user_id}`;
        urlPath = urlPath.replace('{channel_id}', encodeURIComponent(String(requestParameters['channelId'])));
        urlPath = urlPath.replace('{user_id}', encodeURIComponent(String(requestParameters['userId'])));
        return {
            path: urlPath,
            method: 'GET',
            headers: headerParameters,
            query: queryParameters,
        };
    }
    async getChannelMemberRaw(requestParameters, initOverrides) {
        const requestOptions = await this.getChannelMemberRequestOpts(requestParameters);
        const response = await this.request(requestOptions, initOverrides);
        return new runtime.JSONApiResponse(response, (jsonValue) => ChannelMemberFromJSON(jsonValue));
    }
    async getChannelMember(requestParameters, initOverrides) {
        const response = await this.getChannelMemberRaw(requestParameters, initOverrides);
        return await response.value();
    }
    async getChannelMemberCountsByGroupRequestOpts(requestParameters) {
        if (requestParameters['channelId'] == null) {
            throw new runtime.RequiredError('channelId', 'Required parameter "channelId" was null or undefined when calling getChannelMemberCountsByGroup().');
        }
        const queryParameters = {};
        if (requestParameters['includeTimezones'] != null) {
            queryParameters['include_timezones'] = requestParameters['includeTimezones'];
        }
        const headerParameters = {};
        if (this.configuration && this.configuration.accessToken) {
            const token = this.configuration.accessToken;
            const tokenString = await token("bearerAuth", []);
            if (tokenString) {
                headerParameters["Authorization"] = `Bearer ${tokenString}`;
            }
        }
        let urlPath = `/api/v4/channels/{channel_id}/member_counts_by_group`;
        urlPath = urlPath.replace('{channel_id}', encodeURIComponent(String(requestParameters['channelId'])));
        return {
            path: urlPath,
            method: 'GET',
            headers: headerParameters,
            query: queryParameters,
        };
    }
    async getChannelMemberCountsByGroupRaw(requestParameters, initOverrides) {
        const requestOptions = await this.getChannelMemberCountsByGroupRequestOpts(requestParameters);
        const response = await this.request(requestOptions, initOverrides);
        return new runtime.JSONApiResponse(response, (jsonValue) => jsonValue.map(ChannelMemberCountByGroupFromJSON));
    }
    async getChannelMemberCountsByGroup(requestParameters, initOverrides) {
        const response = await this.getChannelMemberCountsByGroupRaw(requestParameters, initOverrides);
        return await response.value();
    }
    async getChannelMembersRequestOpts(requestParameters) {
        if (requestParameters['channelId'] == null) {
            throw new runtime.RequiredError('channelId', 'Required parameter "channelId" was null or undefined when calling getChannelMembers().');
        }
        const queryParameters = {};
        if (requestParameters['page'] != null) {
            queryParameters['page'] = requestParameters['page'];
        }
        if (requestParameters['perPage'] != null) {
            queryParameters['per_page'] = requestParameters['perPage'];
        }
        const headerParameters = {};
        if (this.configuration && this.configuration.accessToken) {
            const token = this.configuration.accessToken;
            const tokenString = await token("bearerAuth", []);
            if (tokenString) {
                headerParameters["Authorization"] = `Bearer ${tokenString}`;
            }
        }
        let urlPath = `/api/v4/channels/{channel_id}/members`;
        urlPath = urlPath.replace('{channel_id}', encodeURIComponent(String(requestParameters['channelId'])));
        return {
            path: urlPath,
            method: 'GET',
            headers: headerParameters,
            query: queryParameters,
        };
    }
    async getChannelMembersRaw(requestParameters, initOverrides) {
        const requestOptions = await this.getChannelMembersRequestOpts(requestParameters);
        const response = await this.request(requestOptions, initOverrides);
        return new runtime.JSONApiResponse(response, (jsonValue) => jsonValue.map(ChannelMemberFromJSON));
    }
    async getChannelMembers(requestParameters, initOverrides) {
        const response = await this.getChannelMembersRaw(requestParameters, initOverrides);
        return await response.value();
    }
    async getChannelMembersByIdsRequestOpts(requestParameters) {
        if (requestParameters['channelId'] == null) {
            throw new runtime.RequiredError('channelId', 'Required parameter "channelId" was null or undefined when calling getChannelMembersByIds().');
        }
        if (requestParameters['requestBody'] == null) {
            throw new runtime.RequiredError('requestBody', 'Required parameter "requestBody" was null or undefined when calling getChannelMembersByIds().');
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
        let urlPath = `/api/v4/channels/{channel_id}/members/ids`;
        urlPath = urlPath.replace('{channel_id}', encodeURIComponent(String(requestParameters['channelId'])));
        return {
            path: urlPath,
            method: 'POST',
            headers: headerParameters,
            query: queryParameters,
            body: requestParameters['requestBody'],
        };
    }
    async getChannelMembersByIdsRaw(requestParameters, initOverrides) {
        const requestOptions = await this.getChannelMembersByIdsRequestOpts(requestParameters);
        const response = await this.request(requestOptions, initOverrides);
        return new runtime.JSONApiResponse(response, (jsonValue) => jsonValue.map(ChannelMemberFromJSON));
    }
    async getChannelMembersByIds(requestParameters, initOverrides) {
        const response = await this.getChannelMembersByIdsRaw(requestParameters, initOverrides);
        return await response.value();
    }
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
    async getChannelMembersTimezonesRequestOpts(requestParameters) {
        if (requestParameters['channelId'] == null) {
            throw new runtime.RequiredError('channelId', 'Required parameter "channelId" was null or undefined when calling getChannelMembersTimezones().');
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
        let urlPath = `/api/v4/channels/{channel_id}/timezones`;
        urlPath = urlPath.replace('{channel_id}', encodeURIComponent(String(requestParameters['channelId'])));
        return {
            path: urlPath,
            method: 'GET',
            headers: headerParameters,
            query: queryParameters,
        };
    }
    async getChannelMembersTimezonesRaw(requestParameters, initOverrides) {
        const requestOptions = await this.getChannelMembersTimezonesRequestOpts(requestParameters);
        const response = await this.request(requestOptions, initOverrides);
        return new runtime.JSONApiResponse(response);
    }
    async getChannelMembersTimezones(requestParameters, initOverrides) {
        const response = await this.getChannelMembersTimezonesRaw(requestParameters, initOverrides);
        return await response.value();
    }
    async getChannelStatsRequestOpts(requestParameters) {
        if (requestParameters['channelId'] == null) {
            throw new runtime.RequiredError('channelId', 'Required parameter "channelId" was null or undefined when calling getChannelStats().');
        }
        const queryParameters = {};
        if (requestParameters['excludeFilesCount'] != null) {
            queryParameters['exclude_files_count'] = requestParameters['excludeFilesCount'];
        }
        const headerParameters = {};
        if (this.configuration && this.configuration.accessToken) {
            const token = this.configuration.accessToken;
            const tokenString = await token("bearerAuth", []);
            if (tokenString) {
                headerParameters["Authorization"] = `Bearer ${tokenString}`;
            }
        }
        let urlPath = `/api/v4/channels/{channel_id}/stats`;
        urlPath = urlPath.replace('{channel_id}', encodeURIComponent(String(requestParameters['channelId'])));
        return {
            path: urlPath,
            method: 'GET',
            headers: headerParameters,
            query: queryParameters,
        };
    }
    async getChannelStatsRaw(requestParameters, initOverrides) {
        const requestOptions = await this.getChannelStatsRequestOpts(requestParameters);
        const response = await this.request(requestOptions, initOverrides);
        return new runtime.JSONApiResponse(response, (jsonValue) => ChannelStatsFromJSON(jsonValue));
    }
    async getChannelStats(requestParameters, initOverrides) {
        const response = await this.getChannelStatsRaw(requestParameters, initOverrides);
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
    async getManagedCategoriesRequestOpts(requestParameters) {
        if (requestParameters['teamId'] == null) {
            throw new runtime.RequiredError('teamId', 'Required parameter "teamId" was null or undefined when calling getManagedCategories().');
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
        let urlPath = `/api/v4/teams/{team_id}/channels/managed_categories`;
        urlPath = urlPath.replace('{team_id}', encodeURIComponent(String(requestParameters['teamId'])));
        return {
            path: urlPath,
            method: 'GET',
            headers: headerParameters,
            query: queryParameters,
        };
    }
    async getManagedCategoriesRaw(requestParameters, initOverrides) {
        const requestOptions = await this.getManagedCategoriesRequestOpts(requestParameters);
        const response = await this.request(requestOptions, initOverrides);
        return new runtime.JSONApiResponse(response);
    }
    async getManagedCategories(requestParameters, initOverrides) {
        const response = await this.getManagedCategoriesRaw(requestParameters, initOverrides);
        return await response.value();
    }
    async getPinnedPostsRequestOpts(requestParameters) {
        if (requestParameters['channelId'] == null) {
            throw new runtime.RequiredError('channelId', 'Required parameter "channelId" was null or undefined when calling getPinnedPosts().');
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
        let urlPath = `/api/v4/channels/{channel_id}/pinned`;
        urlPath = urlPath.replace('{channel_id}', encodeURIComponent(String(requestParameters['channelId'])));
        return {
            path: urlPath,
            method: 'GET',
            headers: headerParameters,
            query: queryParameters,
        };
    }
    async getPinnedPostsRaw(requestParameters, initOverrides) {
        const requestOptions = await this.getPinnedPostsRequestOpts(requestParameters);
        const response = await this.request(requestOptions, initOverrides);
        return new runtime.JSONApiResponse(response, (jsonValue) => PostListFromJSON(jsonValue));
    }
    async getPinnedPosts(requestParameters, initOverrides) {
        const response = await this.getPinnedPostsRaw(requestParameters, initOverrides);
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
    async removeSidebarCategoryForTeamForUserRequestOpts(requestParameters) {
        if (requestParameters['teamId'] == null) {
            throw new runtime.RequiredError('teamId', 'Required parameter "teamId" was null or undefined when calling removeSidebarCategoryForTeamForUser().');
        }
        if (requestParameters['userId'] == null) {
            throw new runtime.RequiredError('userId', 'Required parameter "userId" was null or undefined when calling removeSidebarCategoryForTeamForUser().');
        }
        if (requestParameters['categoryId'] == null) {
            throw new runtime.RequiredError('categoryId', 'Required parameter "categoryId" was null or undefined when calling removeSidebarCategoryForTeamForUser().');
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
        let urlPath = `/api/v4/users/{user_id}/teams/{team_id}/channels/categories/{category_id}`;
        urlPath = urlPath.replace('{team_id}', encodeURIComponent(String(requestParameters['teamId'])));
        urlPath = urlPath.replace('{user_id}', encodeURIComponent(String(requestParameters['userId'])));
        urlPath = urlPath.replace('{category_id}', encodeURIComponent(String(requestParameters['categoryId'])));
        return {
            path: urlPath,
            method: 'DELETE',
            headers: headerParameters,
            query: queryParameters,
        };
    }
    async removeSidebarCategoryForTeamForUserRaw(requestParameters, initOverrides) {
        const requestOptions = await this.removeSidebarCategoryForTeamForUserRequestOpts(requestParameters);
        const response = await this.request(requestOptions, initOverrides);
        return new runtime.JSONApiResponse(response, (jsonValue) => StatusOKFromJSON(jsonValue));
    }
    async removeSidebarCategoryForTeamForUser(requestParameters, initOverrides) {
        const response = await this.removeSidebarCategoryForTeamForUserRaw(requestParameters, initOverrides);
        return await response.value();
    }
    async removeUserFromChannelRequestOpts(requestParameters) {
        if (requestParameters['channelId'] == null) {
            throw new runtime.RequiredError('channelId', 'Required parameter "channelId" was null or undefined when calling removeUserFromChannel().');
        }
        if (requestParameters['userId'] == null) {
            throw new runtime.RequiredError('userId', 'Required parameter "userId" was null or undefined when calling removeUserFromChannel().');
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
        let urlPath = `/api/v4/channels/{channel_id}/members/{user_id}`;
        urlPath = urlPath.replace('{channel_id}', encodeURIComponent(String(requestParameters['channelId'])));
        urlPath = urlPath.replace('{user_id}', encodeURIComponent(String(requestParameters['userId'])));
        return {
            path: urlPath,
            method: 'DELETE',
            headers: headerParameters,
            query: queryParameters,
        };
    }
    async removeUserFromChannelRaw(requestParameters, initOverrides) {
        const requestOptions = await this.removeUserFromChannelRequestOpts(requestParameters);
        const response = await this.request(requestOptions, initOverrides);
        return new runtime.JSONApiResponse(response, (jsonValue) => StatusOKFromJSON(jsonValue));
    }
    async removeUserFromChannel(requestParameters, initOverrides) {
        const response = await this.removeUserFromChannelRaw(requestParameters, initOverrides);
        return await response.value();
    }
    async updateChannelNotifyPropsRequestOpts(requestParameters) {
        if (requestParameters['channelId'] == null) {
            throw new runtime.RequiredError('channelId', 'Required parameter "channelId" was null or undefined when calling updateChannelNotifyProps().');
        }
        if (requestParameters['userId'] == null) {
            throw new runtime.RequiredError('userId', 'Required parameter "userId" was null or undefined when calling updateChannelNotifyProps().');
        }
        if (requestParameters['channelNotifyProps'] == null) {
            throw new runtime.RequiredError('channelNotifyProps', 'Required parameter "channelNotifyProps" was null or undefined when calling updateChannelNotifyProps().');
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
        let urlPath = `/api/v4/channels/{channel_id}/members/{user_id}/notify_props`;
        urlPath = urlPath.replace('{channel_id}', encodeURIComponent(String(requestParameters['channelId'])));
        urlPath = urlPath.replace('{user_id}', encodeURIComponent(String(requestParameters['userId'])));
        return {
            path: urlPath,
            method: 'PUT',
            headers: headerParameters,
            query: queryParameters,
            body: ChannelNotifyPropsToJSON(requestParameters['channelNotifyProps']),
        };
    }
    async updateChannelNotifyPropsRaw(requestParameters, initOverrides) {
        const requestOptions = await this.updateChannelNotifyPropsRequestOpts(requestParameters);
        const response = await this.request(requestOptions, initOverrides);
        return new runtime.JSONApiResponse(response, (jsonValue) => StatusOKFromJSON(jsonValue));
    }
    async updateChannelNotifyProps(requestParameters, initOverrides) {
        const response = await this.updateChannelNotifyPropsRaw(requestParameters, initOverrides);
        return await response.value();
    }
    async updateSidebarCategoriesForTeamForUserRequestOpts(requestParameters) {
        if (requestParameters['teamId'] == null) {
            throw new runtime.RequiredError('teamId', 'Required parameter "teamId" was null or undefined when calling updateSidebarCategoriesForTeamForUser().');
        }
        if (requestParameters['userId'] == null) {
            throw new runtime.RequiredError('userId', 'Required parameter "userId" was null or undefined when calling updateSidebarCategoriesForTeamForUser().');
        }
        if (requestParameters['sidebarCategoryWithChannels'] == null) {
            throw new runtime.RequiredError('sidebarCategoryWithChannels', 'Required parameter "sidebarCategoryWithChannels" was null or undefined when calling updateSidebarCategoriesForTeamForUser().');
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
        let urlPath = `/api/v4/users/{user_id}/teams/{team_id}/channels/categories`;
        urlPath = urlPath.replace('{team_id}', encodeURIComponent(String(requestParameters['teamId'])));
        urlPath = urlPath.replace('{user_id}', encodeURIComponent(String(requestParameters['userId'])));
        return {
            path: urlPath,
            method: 'PUT',
            headers: headerParameters,
            query: queryParameters,
            body: requestParameters['sidebarCategoryWithChannels'].map(SidebarCategoryWithChannelsToJSON),
        };
    }
    async updateSidebarCategoriesForTeamForUserRaw(requestParameters, initOverrides) {
        const requestOptions = await this.updateSidebarCategoriesForTeamForUserRequestOpts(requestParameters);
        const response = await this.request(requestOptions, initOverrides);
        return new runtime.JSONApiResponse(response, (jsonValue) => jsonValue.map(SidebarCategoryWithChannelsFromJSON));
    }
    async updateSidebarCategoriesForTeamForUser(requestParameters, initOverrides) {
        const response = await this.updateSidebarCategoriesForTeamForUserRaw(requestParameters, initOverrides);
        return await response.value();
    }
    async updateSidebarCategoryForTeamForUserRequestOpts(requestParameters) {
        if (requestParameters['teamId'] == null) {
            throw new runtime.RequiredError('teamId', 'Required parameter "teamId" was null or undefined when calling updateSidebarCategoryForTeamForUser().');
        }
        if (requestParameters['userId'] == null) {
            throw new runtime.RequiredError('userId', 'Required parameter "userId" was null or undefined when calling updateSidebarCategoryForTeamForUser().');
        }
        if (requestParameters['categoryId'] == null) {
            throw new runtime.RequiredError('categoryId', 'Required parameter "categoryId" was null or undefined when calling updateSidebarCategoryForTeamForUser().');
        }
        if (requestParameters['sidebarCategoryWithChannels'] == null) {
            throw new runtime.RequiredError('sidebarCategoryWithChannels', 'Required parameter "sidebarCategoryWithChannels" was null or undefined when calling updateSidebarCategoryForTeamForUser().');
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
        let urlPath = `/api/v4/users/{user_id}/teams/{team_id}/channels/categories/{category_id}`;
        urlPath = urlPath.replace('{team_id}', encodeURIComponent(String(requestParameters['teamId'])));
        urlPath = urlPath.replace('{user_id}', encodeURIComponent(String(requestParameters['userId'])));
        urlPath = urlPath.replace('{category_id}', encodeURIComponent(String(requestParameters['categoryId'])));
        return {
            path: urlPath,
            method: 'PUT',
            headers: headerParameters,
            query: queryParameters,
            body: SidebarCategoryWithChannelsToJSON(requestParameters['sidebarCategoryWithChannels']),
        };
    }
    async updateSidebarCategoryForTeamForUserRaw(requestParameters, initOverrides) {
        const requestOptions = await this.updateSidebarCategoryForTeamForUserRequestOpts(requestParameters);
        const response = await this.request(requestOptions, initOverrides);
        return new runtime.JSONApiResponse(response, (jsonValue) => SidebarCategoryWithChannelsFromJSON(jsonValue));
    }
    async updateSidebarCategoryForTeamForUser(requestParameters, initOverrides) {
        const response = await this.updateSidebarCategoryForTeamForUserRaw(requestParameters, initOverrides);
        return await response.value();
    }
    async updateSidebarCategoryOrderForTeamForUserRequestOpts(requestParameters) {
        if (requestParameters['teamId'] == null) {
            throw new runtime.RequiredError('teamId', 'Required parameter "teamId" was null or undefined when calling updateSidebarCategoryOrderForTeamForUser().');
        }
        if (requestParameters['userId'] == null) {
            throw new runtime.RequiredError('userId', 'Required parameter "userId" was null or undefined when calling updateSidebarCategoryOrderForTeamForUser().');
        }
        if (requestParameters['requestBody'] == null) {
            throw new runtime.RequiredError('requestBody', 'Required parameter "requestBody" was null or undefined when calling updateSidebarCategoryOrderForTeamForUser().');
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
        let urlPath = `/api/v4/users/{user_id}/teams/{team_id}/channels/categories/order`;
        urlPath = urlPath.replace('{team_id}', encodeURIComponent(String(requestParameters['teamId'])));
        urlPath = urlPath.replace('{user_id}', encodeURIComponent(String(requestParameters['userId'])));
        return {
            path: urlPath,
            method: 'PUT',
            headers: headerParameters,
            query: queryParameters,
            body: requestParameters['requestBody'],
        };
    }
    async updateSidebarCategoryOrderForTeamForUserRaw(requestParameters, initOverrides) {
        const requestOptions = await this.updateSidebarCategoryOrderForTeamForUserRequestOpts(requestParameters);
        const response = await this.request(requestOptions, initOverrides);
        return new runtime.JSONApiResponse(response);
    }
    async updateSidebarCategoryOrderForTeamForUser(requestParameters, initOverrides) {
        const response = await this.updateSidebarCategoryOrderForTeamForUserRaw(requestParameters, initOverrides);
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
