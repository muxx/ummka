import * as runtime from '../runtime.js';
import { ReactionFromJSON, } from '../models/Reaction.js';
export class ReactionsApi extends runtime.BaseAPI {
    async getReactionsRequestOpts(requestParameters) {
        if (requestParameters['postId'] == null) {
            throw new runtime.RequiredError('postId', 'Required parameter "postId" was null or undefined when calling getReactions().');
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
        let urlPath = `/api/v4/posts/{post_id}/reactions`;
        urlPath = urlPath.replace('{post_id}', encodeURIComponent(String(requestParameters['postId'])));
        return {
            path: urlPath,
            method: 'GET',
            headers: headerParameters,
            query: queryParameters,
        };
    }
    async getReactionsRaw(requestParameters, initOverrides) {
        const requestOptions = await this.getReactionsRequestOpts(requestParameters);
        const response = await this.request(requestOptions, initOverrides);
        return new runtime.JSONApiResponse(response, (jsonValue) => jsonValue === null ? null : jsonValue.map(ReactionFromJSON));
    }
    async getReactions(requestParameters, initOverrides) {
        const response = await this.getReactionsRaw(requestParameters, initOverrides);
        return await response.value();
    }
}
