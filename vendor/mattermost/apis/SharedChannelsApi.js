import * as runtime from '../runtime.js';
import { CanUserDirectMessage200ResponseFromJSON, } from '../models/CanUserDirectMessage200Response.js';
export class SharedChannelsApi extends runtime.BaseAPI {
    async canUserDirectMessageRequestOpts(requestParameters) {
        if (requestParameters['userId'] == null) {
            throw new runtime.RequiredError('userId', 'Required parameter "userId" was null or undefined when calling canUserDirectMessage().');
        }
        if (requestParameters['otherUserId'] == null) {
            throw new runtime.RequiredError('otherUserId', 'Required parameter "otherUserId" was null or undefined when calling canUserDirectMessage().');
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
        let urlPath = `/api/v4/sharedchannels/users/{user_id}/can_dm/{other_user_id}`;
        urlPath = urlPath.replace('{user_id}', encodeURIComponent(String(requestParameters['userId'])));
        urlPath = urlPath.replace('{other_user_id}', encodeURIComponent(String(requestParameters['otherUserId'])));
        return {
            path: urlPath,
            method: 'GET',
            headers: headerParameters,
            query: queryParameters,
        };
    }
    async canUserDirectMessageRaw(requestParameters, initOverrides) {
        const requestOptions = await this.canUserDirectMessageRequestOpts(requestParameters);
        const response = await this.request(requestOptions, initOverrides);
        return new runtime.JSONApiResponse(response, (jsonValue) => CanUserDirectMessage200ResponseFromJSON(jsonValue));
    }
    async canUserDirectMessage(requestParameters, initOverrides) {
        const response = await this.canUserDirectMessageRaw(requestParameters, initOverrides);
        return await response.value();
    }
}
