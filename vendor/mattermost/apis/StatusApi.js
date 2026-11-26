import * as runtime from '../runtime.js';
import { StatusFromJSON, } from '../models/Status.js';
export class StatusApi extends runtime.BaseAPI {
    async getUsersStatusesByIdsRequestOpts(requestParameters) {
        if (requestParameters['requestBody'] == null) {
            throw new runtime.RequiredError('requestBody', 'Required parameter "requestBody" was null or undefined when calling getUsersStatusesByIds().');
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
        let urlPath = `/api/v4/users/status/ids`;
        return {
            path: urlPath,
            method: 'POST',
            headers: headerParameters,
            query: queryParameters,
            body: requestParameters['requestBody'],
        };
    }
    async getUsersStatusesByIdsRaw(requestParameters, initOverrides) {
        const requestOptions = await this.getUsersStatusesByIdsRequestOpts(requestParameters);
        const response = await this.request(requestOptions, initOverrides);
        return new runtime.JSONApiResponse(response, (jsonValue) => jsonValue.map(StatusFromJSON));
    }
    async getUsersStatusesByIds(requestParameters, initOverrides) {
        const response = await this.getUsersStatusesByIdsRaw(requestParameters, initOverrides);
        return await response.value();
    }
}
