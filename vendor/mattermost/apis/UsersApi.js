import * as runtime from '../runtime.js';
import { SearchUsersRequestToJSON, } from '../models/SearchUsersRequest.js';
import { UserFromJSON, } from '../models/User.js';
export class UsersApi extends runtime.BaseAPI {
    async getProfileImageRequestOpts(requestParameters) {
        if (requestParameters['userId'] == null) {
            throw new runtime.RequiredError('userId', 'Required parameter "userId" was null or undefined when calling getProfileImage().');
        }
        const queryParameters = {};
        if (requestParameters['u'] != null) {
            queryParameters['_'] = requestParameters['u'];
        }
        const headerParameters = {};
        if (this.configuration && this.configuration.accessToken) {
            const token = this.configuration.accessToken;
            const tokenString = await token("bearerAuth", []);
            if (tokenString) {
                headerParameters["Authorization"] = `Bearer ${tokenString}`;
            }
        }
        let urlPath = `/api/v4/users/{user_id}/image`;
        urlPath = urlPath.replace('{user_id}', encodeURIComponent(String(requestParameters['userId'])));
        return {
            path: urlPath,
            method: 'GET',
            headers: headerParameters,
            query: queryParameters,
        };
    }
    async getProfileImageRaw(requestParameters, initOverrides) {
        const requestOptions = await this.getProfileImageRequestOpts(requestParameters);
        const response = await this.request(requestOptions, initOverrides);
        return new runtime.BlobApiResponse(response);
    }
    async getProfileImage(requestParameters, initOverrides) {
        const response = await this.getProfileImageRaw(requestParameters, initOverrides);
        return await response.value();
    }
    async getUserRequestOpts(requestParameters) {
        if (requestParameters['userId'] == null) {
            throw new runtime.RequiredError('userId', 'Required parameter "userId" was null or undefined when calling getUser().');
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
        let urlPath = `/api/v4/users/{user_id}`;
        urlPath = urlPath.replace('{user_id}', encodeURIComponent(String(requestParameters['userId'])));
        return {
            path: urlPath,
            method: 'GET',
            headers: headerParameters,
            query: queryParameters,
        };
    }
    async getUserRaw(requestParameters, initOverrides) {
        const requestOptions = await this.getUserRequestOpts(requestParameters);
        const response = await this.request(requestOptions, initOverrides);
        return new runtime.JSONApiResponse(response, (jsonValue) => UserFromJSON(jsonValue));
    }
    async getUser(requestParameters, initOverrides) {
        const response = await this.getUserRaw(requestParameters, initOverrides);
        return await response.value();
    }
    async getUserByEmailRequestOpts(requestParameters) {
        if (requestParameters['email'] == null) {
            throw new runtime.RequiredError('email', 'Required parameter "email" was null or undefined when calling getUserByEmail().');
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
        let urlPath = `/api/v4/users/email/{email}`;
        urlPath = urlPath.replace('{email}', encodeURIComponent(String(requestParameters['email'])));
        return {
            path: urlPath,
            method: 'GET',
            headers: headerParameters,
            query: queryParameters,
        };
    }
    async getUserByEmailRaw(requestParameters, initOverrides) {
        const requestOptions = await this.getUserByEmailRequestOpts(requestParameters);
        const response = await this.request(requestOptions, initOverrides);
        return new runtime.JSONApiResponse(response, (jsonValue) => UserFromJSON(jsonValue));
    }
    async getUserByEmail(requestParameters, initOverrides) {
        const response = await this.getUserByEmailRaw(requestParameters, initOverrides);
        return await response.value();
    }
    async getUserByUsernameRequestOpts(requestParameters) {
        if (requestParameters['username'] == null) {
            throw new runtime.RequiredError('username', 'Required parameter "username" was null or undefined when calling getUserByUsername().');
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
        let urlPath = `/api/v4/users/username/{username}`;
        urlPath = urlPath.replace('{username}', encodeURIComponent(String(requestParameters['username'])));
        return {
            path: urlPath,
            method: 'GET',
            headers: headerParameters,
            query: queryParameters,
        };
    }
    async getUserByUsernameRaw(requestParameters, initOverrides) {
        const requestOptions = await this.getUserByUsernameRequestOpts(requestParameters);
        const response = await this.request(requestOptions, initOverrides);
        return new runtime.JSONApiResponse(response, (jsonValue) => UserFromJSON(jsonValue));
    }
    async getUserByUsername(requestParameters, initOverrides) {
        const response = await this.getUserByUsernameRaw(requestParameters, initOverrides);
        return await response.value();
    }
    async getUsersRequestOpts(requestParameters) {
        const queryParameters = {};
        if (requestParameters['page'] != null) {
            queryParameters['page'] = requestParameters['page'];
        }
        if (requestParameters['perPage'] != null) {
            queryParameters['per_page'] = requestParameters['perPage'];
        }
        if (requestParameters['inTeam'] != null) {
            queryParameters['in_team'] = requestParameters['inTeam'];
        }
        if (requestParameters['notInTeam'] != null) {
            queryParameters['not_in_team'] = requestParameters['notInTeam'];
        }
        if (requestParameters['inChannel'] != null) {
            queryParameters['in_channel'] = requestParameters['inChannel'];
        }
        if (requestParameters['notInChannel'] != null) {
            queryParameters['not_in_channel'] = requestParameters['notInChannel'];
        }
        if (requestParameters['inGroup'] != null) {
            queryParameters['in_group'] = requestParameters['inGroup'];
        }
        if (requestParameters['groupConstrained'] != null) {
            queryParameters['group_constrained'] = requestParameters['groupConstrained'];
        }
        if (requestParameters['withoutTeam'] != null) {
            queryParameters['without_team'] = requestParameters['withoutTeam'];
        }
        if (requestParameters['active'] != null) {
            queryParameters['active'] = requestParameters['active'];
        }
        if (requestParameters['inactive'] != null) {
            queryParameters['inactive'] = requestParameters['inactive'];
        }
        if (requestParameters['role'] != null) {
            queryParameters['role'] = requestParameters['role'];
        }
        if (requestParameters['sort'] != null) {
            queryParameters['sort'] = requestParameters['sort'];
        }
        if (requestParameters['roles'] != null) {
            queryParameters['roles'] = requestParameters['roles'];
        }
        if (requestParameters['channelRoles'] != null) {
            queryParameters['channel_roles'] = requestParameters['channelRoles'];
        }
        if (requestParameters['teamRoles'] != null) {
            queryParameters['team_roles'] = requestParameters['teamRoles'];
        }
        const headerParameters = {};
        if (this.configuration && this.configuration.accessToken) {
            const token = this.configuration.accessToken;
            const tokenString = await token("bearerAuth", []);
            if (tokenString) {
                headerParameters["Authorization"] = `Bearer ${tokenString}`;
            }
        }
        let urlPath = `/api/v4/users`;
        return {
            path: urlPath,
            method: 'GET',
            headers: headerParameters,
            query: queryParameters,
        };
    }
    async getUsersRaw(requestParameters, initOverrides) {
        const requestOptions = await this.getUsersRequestOpts(requestParameters);
        const response = await this.request(requestOptions, initOverrides);
        return new runtime.JSONApiResponse(response, (jsonValue) => jsonValue.map(UserFromJSON));
    }
    async getUsers(requestParameters = {}, initOverrides) {
        const response = await this.getUsersRaw(requestParameters, initOverrides);
        return await response.value();
    }
    async getUsersByIdsRequestOpts(requestParameters) {
        if (requestParameters['requestBody'] == null) {
            throw new runtime.RequiredError('requestBody', 'Required parameter "requestBody" was null or undefined when calling getUsersByIds().');
        }
        const queryParameters = {};
        if (requestParameters['since'] != null) {
            queryParameters['since'] = requestParameters['since'];
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
        let urlPath = `/api/v4/users/ids`;
        return {
            path: urlPath,
            method: 'POST',
            headers: headerParameters,
            query: queryParameters,
            body: requestParameters['requestBody'],
        };
    }
    async getUsersByIdsRaw(requestParameters, initOverrides) {
        const requestOptions = await this.getUsersByIdsRequestOpts(requestParameters);
        const response = await this.request(requestOptions, initOverrides);
        return new runtime.JSONApiResponse(response, (jsonValue) => jsonValue.map(UserFromJSON));
    }
    async getUsersByIds(requestParameters, initOverrides) {
        const response = await this.getUsersByIdsRaw(requestParameters, initOverrides);
        return await response.value();
    }
    async getUsersByUsernamesRequestOpts(requestParameters) {
        if (requestParameters['requestBody'] == null) {
            throw new runtime.RequiredError('requestBody', 'Required parameter "requestBody" was null or undefined when calling getUsersByUsernames().');
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
        let urlPath = `/api/v4/users/usernames`;
        return {
            path: urlPath,
            method: 'POST',
            headers: headerParameters,
            query: queryParameters,
            body: requestParameters['requestBody'],
        };
    }
    async getUsersByUsernamesRaw(requestParameters, initOverrides) {
        const requestOptions = await this.getUsersByUsernamesRequestOpts(requestParameters);
        const response = await this.request(requestOptions, initOverrides);
        return new runtime.JSONApiResponse(response, (jsonValue) => jsonValue.map(UserFromJSON));
    }
    async getUsersByUsernames(requestParameters, initOverrides) {
        const response = await this.getUsersByUsernamesRaw(requestParameters, initOverrides);
        return await response.value();
    }
    async searchUsersRequestOpts(requestParameters) {
        if (requestParameters['searchUsersRequest'] == null) {
            throw new runtime.RequiredError('searchUsersRequest', 'Required parameter "searchUsersRequest" was null or undefined when calling searchUsers().');
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
        let urlPath = `/api/v4/users/search`;
        return {
            path: urlPath,
            method: 'POST',
            headers: headerParameters,
            query: queryParameters,
            body: SearchUsersRequestToJSON(requestParameters['searchUsersRequest']),
        };
    }
    async searchUsersRaw(requestParameters, initOverrides) {
        const requestOptions = await this.searchUsersRequestOpts(requestParameters);
        const response = await this.request(requestOptions, initOverrides);
        return new runtime.JSONApiResponse(response, (jsonValue) => jsonValue.map(UserFromJSON));
    }
    async searchUsers(requestParameters, initOverrides) {
        const response = await this.searchUsersRaw(requestParameters, initOverrides);
        return await response.value();
    }
}
