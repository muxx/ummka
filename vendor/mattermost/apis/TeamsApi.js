import * as runtime from '../runtime.js';
import { TeamFromJSON, } from '../models/Team.js';
export class TeamsApi extends runtime.BaseAPI {
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
}
