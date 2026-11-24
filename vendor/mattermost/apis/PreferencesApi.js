import * as runtime from '../runtime.js';
import { PreferenceFromJSON, } from '../models/Preference.js';
export class PreferencesApi extends runtime.BaseAPI {
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
        return new runtime.JSONApiResponse(response, (jsonValue) => jsonValue.map(PreferenceFromJSON));
    }
    async getPreferences(requestParameters, initOverrides) {
        const response = await this.getPreferencesRaw(requestParameters, initOverrides);
        return await response.value();
    }
}
