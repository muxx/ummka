import * as runtime from '../runtime.js';
import { UserFromJSON, } from '../models/User.js';
export class UsersApi extends runtime.BaseAPI {
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
}
