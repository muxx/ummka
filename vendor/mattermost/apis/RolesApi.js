import * as runtime from '../runtime.js';
import { RoleFromJSON, } from '../models/Role.js';
export class RolesApi extends runtime.BaseAPI {
    async getRolesByNamesRequestOpts(requestParameters) {
        if (requestParameters['requestBody'] == null) {
            throw new runtime.RequiredError('requestBody', 'Required parameter "requestBody" was null or undefined when calling getRolesByNames().');
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
        let urlPath = `/api/v4/roles/names`;
        return {
            path: urlPath,
            method: 'POST',
            headers: headerParameters,
            query: queryParameters,
            body: requestParameters['requestBody'],
        };
    }
    async getRolesByNamesRaw(requestParameters, initOverrides) {
        const requestOptions = await this.getRolesByNamesRequestOpts(requestParameters);
        const response = await this.request(requestOptions, initOverrides);
        return new runtime.JSONApiResponse(response, (jsonValue) => jsonValue === null ? null : jsonValue.map(RoleFromJSON));
    }
    async getRolesByNames(requestParameters, initOverrides) {
        const response = await this.getRolesByNamesRaw(requestParameters, initOverrides);
        return await response.value();
    }
}
