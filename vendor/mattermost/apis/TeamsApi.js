import * as runtime from '../runtime.js';
import { AddTeamMemberRequestToJSON, } from '../models/AddTeamMemberRequest.js';
import { StatusOKFromJSON, } from '../models/StatusOK.js';
import { TeamFromJSON, } from '../models/Team.js';
import { TeamMemberFromJSON, } from '../models/TeamMember.js';
export class TeamsApi extends runtime.BaseAPI {
    async addTeamMemberRequestOpts(requestParameters) {
        if (requestParameters['teamId'] == null) {
            throw new runtime.RequiredError('teamId', 'Required parameter "teamId" was null or undefined when calling addTeamMember().');
        }
        if (requestParameters['addTeamMemberRequest'] == null) {
            throw new runtime.RequiredError('addTeamMemberRequest', 'Required parameter "addTeamMemberRequest" was null or undefined when calling addTeamMember().');
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
        let urlPath = `/api/v4/teams/{team_id}/members`;
        urlPath = urlPath.replace('{team_id}', encodeURIComponent(String(requestParameters['teamId'])));
        return {
            path: urlPath,
            method: 'POST',
            headers: headerParameters,
            query: queryParameters,
            body: AddTeamMemberRequestToJSON(requestParameters['addTeamMemberRequest']),
        };
    }
    async addTeamMemberRaw(requestParameters, initOverrides) {
        const requestOptions = await this.addTeamMemberRequestOpts(requestParameters);
        const response = await this.request(requestOptions, initOverrides);
        return new runtime.JSONApiResponse(response, (jsonValue) => TeamMemberFromJSON(jsonValue));
    }
    async addTeamMember(requestParameters, initOverrides) {
        const response = await this.addTeamMemberRaw(requestParameters, initOverrides);
        return await response.value();
    }
    async getTeamByNameRequestOpts(requestParameters) {
        if (requestParameters['name'] == null) {
            throw new runtime.RequiredError('name', 'Required parameter "name" was null or undefined when calling getTeamByName().');
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
        let urlPath = `/api/v4/teams/name/{name}`;
        urlPath = urlPath.replace('{name}', encodeURIComponent(String(requestParameters['name'])));
        return {
            path: urlPath,
            method: 'GET',
            headers: headerParameters,
            query: queryParameters,
        };
    }
    async getTeamByNameRaw(requestParameters, initOverrides) {
        const requestOptions = await this.getTeamByNameRequestOpts(requestParameters);
        const response = await this.request(requestOptions, initOverrides);
        return new runtime.JSONApiResponse(response, (jsonValue) => TeamFromJSON(jsonValue));
    }
    async getTeamByName(requestParameters, initOverrides) {
        const response = await this.getTeamByNameRaw(requestParameters, initOverrides);
        return await response.value();
    }
    async getTeamMembersForUserRequestOpts(requestParameters) {
        if (requestParameters['userId'] == null) {
            throw new runtime.RequiredError('userId', 'Required parameter "userId" was null or undefined when calling getTeamMembersForUser().');
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
        let urlPath = `/api/v4/users/{user_id}/teams/members`;
        urlPath = urlPath.replace('{user_id}', encodeURIComponent(String(requestParameters['userId'])));
        return {
            path: urlPath,
            method: 'GET',
            headers: headerParameters,
            query: queryParameters,
        };
    }
    async getTeamMembersForUserRaw(requestParameters, initOverrides) {
        const requestOptions = await this.getTeamMembersForUserRequestOpts(requestParameters);
        const response = await this.request(requestOptions, initOverrides);
        return new runtime.JSONApiResponse(response, (jsonValue) => jsonValue.map(TeamMemberFromJSON));
    }
    async getTeamMembersForUser(requestParameters, initOverrides) {
        const response = await this.getTeamMembersForUserRaw(requestParameters, initOverrides);
        return await response.value();
    }
    async getTeamsForUserRequestOpts(requestParameters) {
        if (requestParameters['userId'] == null) {
            throw new runtime.RequiredError('userId', 'Required parameter "userId" was null or undefined when calling getTeamsForUser().');
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
        let urlPath = `/api/v4/users/{user_id}/teams`;
        urlPath = urlPath.replace('{user_id}', encodeURIComponent(String(requestParameters['userId'])));
        return {
            path: urlPath,
            method: 'GET',
            headers: headerParameters,
            query: queryParameters,
        };
    }
    async getTeamsForUserRaw(requestParameters, initOverrides) {
        const requestOptions = await this.getTeamsForUserRequestOpts(requestParameters);
        const response = await this.request(requestOptions, initOverrides);
        return new runtime.JSONApiResponse(response, (jsonValue) => jsonValue.map(TeamFromJSON));
    }
    async getTeamsForUser(requestParameters, initOverrides) {
        const response = await this.getTeamsForUserRaw(requestParameters, initOverrides);
        return await response.value();
    }
    async removeTeamMemberRequestOpts(requestParameters) {
        if (requestParameters['teamId'] == null) {
            throw new runtime.RequiredError('teamId', 'Required parameter "teamId" was null or undefined when calling removeTeamMember().');
        }
        if (requestParameters['userId'] == null) {
            throw new runtime.RequiredError('userId', 'Required parameter "userId" was null or undefined when calling removeTeamMember().');
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
        let urlPath = `/api/v4/teams/{team_id}/members/{user_id}`;
        urlPath = urlPath.replace('{team_id}', encodeURIComponent(String(requestParameters['teamId'])));
        urlPath = urlPath.replace('{user_id}', encodeURIComponent(String(requestParameters['userId'])));
        return {
            path: urlPath,
            method: 'DELETE',
            headers: headerParameters,
            query: queryParameters,
        };
    }
    async removeTeamMemberRaw(requestParameters, initOverrides) {
        const requestOptions = await this.removeTeamMemberRequestOpts(requestParameters);
        const response = await this.request(requestOptions, initOverrides);
        return new runtime.JSONApiResponse(response, (jsonValue) => StatusOKFromJSON(jsonValue));
    }
    async removeTeamMember(requestParameters, initOverrides) {
        const response = await this.removeTeamMemberRaw(requestParameters, initOverrides);
        return await response.value();
    }
}
