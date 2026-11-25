import * as runtime from '../runtime.js';
import { CommandResponseFromJSON, } from '../models/CommandResponse.js';
import { ExecuteCommandRequestToJSON, } from '../models/ExecuteCommandRequest.js';
export class CommandsApi extends runtime.BaseAPI {
    async executeCommandRequestOpts(requestParameters) {
        if (requestParameters['executeCommandRequest'] == null) {
            throw new runtime.RequiredError('executeCommandRequest', 'Required parameter "executeCommandRequest" was null or undefined when calling executeCommand().');
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
        let urlPath = `/api/v4/commands/execute`;
        return {
            path: urlPath,
            method: 'POST',
            headers: headerParameters,
            query: queryParameters,
            body: ExecuteCommandRequestToJSON(requestParameters['executeCommandRequest']),
        };
    }
    async executeCommandRaw(requestParameters, initOverrides) {
        const requestOptions = await this.executeCommandRequestOpts(requestParameters);
        const response = await this.request(requestOptions, initOverrides);
        return new runtime.JSONApiResponse(response, (jsonValue) => CommandResponseFromJSON(jsonValue));
    }
    async executeCommand(requestParameters, initOverrides) {
        const response = await this.executeCommandRaw(requestParameters, initOverrides);
        return await response.value();
    }
}
