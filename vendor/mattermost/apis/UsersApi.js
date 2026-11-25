import * as runtime from '../runtime.js';
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
}
