import * as runtime from '../runtime.js';
import { PreferenceFromJSON, PreferenceToJSON, } from '../models/Preference.js';
import { StatusOKFromJSON, } from '../models/StatusOK.js';
export class PreferencesApi extends runtime.BaseAPI {
    async deletePreferencesRequestOpts(requestParameters) {
        if (requestParameters['userId'] == null) {
            throw new runtime.RequiredError('userId', 'Required parameter "userId" was null or undefined when calling deletePreferences().');
        }
        if (requestParameters['preference'] == null) {
            throw new runtime.RequiredError('preference', 'Required parameter "preference" was null or undefined when calling deletePreferences().');
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
        let urlPath = `/api/v4/users/{user_id}/preferences/delete`;
        urlPath = urlPath.replace('{user_id}', encodeURIComponent(String(requestParameters['userId'])));
        return {
            path: urlPath,
            method: 'POST',
            headers: headerParameters,
            query: queryParameters,
            body: requestParameters['preference'].map(PreferenceToJSON),
        };
    }
    async deletePreferencesRaw(requestParameters, initOverrides) {
        const requestOptions = await this.deletePreferencesRequestOpts(requestParameters);
        const response = await this.request(requestOptions, initOverrides);
        return new runtime.JSONApiResponse(response, (jsonValue) => StatusOKFromJSON(jsonValue));
    }
    async deletePreferences(requestParameters, initOverrides) {
        const response = await this.deletePreferencesRaw(requestParameters, initOverrides);
        return await response.value();
    }
    async getPreferencesRequestOpts(requestParameters) {
        if (requestParameters['userId'] == null) {
            throw new runtime.RequiredError('userId', 'Required parameter "userId" was null or undefined when calling getPreferences().');
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
        let urlPath = `/api/v4/users/{user_id}/preferences`;
        urlPath = urlPath.replace('{user_id}', encodeURIComponent(String(requestParameters['userId'])));
        return {
            path: urlPath,
            method: 'GET',
            headers: headerParameters,
            query: queryParameters,
        };
    }
    async getPreferencesRaw(requestParameters, initOverrides) {
        const requestOptions = await this.getPreferencesRequestOpts(requestParameters);
        const response = await this.request(requestOptions, initOverrides);
        return new runtime.JSONApiResponse(response, (jsonValue) => jsonValue === null ? null : jsonValue.map(PreferenceFromJSON));
    }
    async getPreferences(requestParameters, initOverrides) {
        const response = await this.getPreferencesRaw(requestParameters, initOverrides);
        return await response.value();
    }
    async updatePreferencesRequestOpts(requestParameters) {
        if (requestParameters['userId'] == null) {
            throw new runtime.RequiredError('userId', 'Required parameter "userId" was null or undefined when calling updatePreferences().');
        }
        if (requestParameters['preference'] == null) {
            throw new runtime.RequiredError('preference', 'Required parameter "preference" was null or undefined when calling updatePreferences().');
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
        let urlPath = `/api/v4/users/{user_id}/preferences`;
        urlPath = urlPath.replace('{user_id}', encodeURIComponent(String(requestParameters['userId'])));
        return {
            path: urlPath,
            method: 'PUT',
            headers: headerParameters,
            query: queryParameters,
            body: requestParameters['preference'].map(PreferenceToJSON),
        };
    }
    async updatePreferencesRaw(requestParameters, initOverrides) {
        const requestOptions = await this.updatePreferencesRequestOpts(requestParameters);
        const response = await this.request(requestOptions, initOverrides);
        return new runtime.JSONApiResponse(response, (jsonValue) => StatusOKFromJSON(jsonValue));
    }
    async updatePreferences(requestParameters, initOverrides) {
        const response = await this.updatePreferencesRaw(requestParameters, initOverrides);
        return await response.value();
    }
}
