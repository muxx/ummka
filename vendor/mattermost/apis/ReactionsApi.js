import * as runtime from '../runtime.js';
import { ReactionFromJSON, } from '../models/Reaction.js';
import { SaveReactionRequestToJSON, } from '../models/SaveReactionRequest.js';
import { StatusOKFromJSON, } from '../models/StatusOK.js';
export class ReactionsApi extends runtime.BaseAPI {
    async deleteReactionRequestOpts(requestParameters) {
        if (requestParameters['userId'] == null) {
            throw new runtime.RequiredError('userId', 'Required parameter "userId" was null or undefined when calling deleteReaction().');
        }
        if (requestParameters['postId'] == null) {
            throw new runtime.RequiredError('postId', 'Required parameter "postId" was null or undefined when calling deleteReaction().');
        }
        if (requestParameters['emojiName'] == null) {
            throw new runtime.RequiredError('emojiName', 'Required parameter "emojiName" was null or undefined when calling deleteReaction().');
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
        let urlPath = `/api/v4/users/{user_id}/posts/{post_id}/reactions/{emoji_name}`;
        urlPath = urlPath.replace('{user_id}', encodeURIComponent(String(requestParameters['userId'])));
        urlPath = urlPath.replace('{post_id}', encodeURIComponent(String(requestParameters['postId'])));
        urlPath = urlPath.replace('{emoji_name}', encodeURIComponent(String(requestParameters['emojiName'])));
        return {
            path: urlPath,
            method: 'DELETE',
            headers: headerParameters,
            query: queryParameters,
        };
    }
    async deleteReactionRaw(requestParameters, initOverrides) {
        const requestOptions = await this.deleteReactionRequestOpts(requestParameters);
        const response = await this.request(requestOptions, initOverrides);
        return new runtime.JSONApiResponse(response, (jsonValue) => StatusOKFromJSON(jsonValue));
    }
    async deleteReaction(requestParameters, initOverrides) {
        const response = await this.deleteReactionRaw(requestParameters, initOverrides);
        return await response.value();
    }
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
    async saveReactionRequestOpts(requestParameters) {
        if (requestParameters['saveReactionRequest'] == null) {
            throw new runtime.RequiredError('saveReactionRequest', 'Required parameter "saveReactionRequest" was null or undefined when calling saveReaction().');
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
        let urlPath = `/api/v4/reactions`;
        return {
            path: urlPath,
            method: 'POST',
            headers: headerParameters,
            query: queryParameters,
            body: SaveReactionRequestToJSON(requestParameters['saveReactionRequest']),
        };
    }
    async saveReactionRaw(requestParameters, initOverrides) {
        const requestOptions = await this.saveReactionRequestOpts(requestParameters);
        const response = await this.request(requestOptions, initOverrides);
        return new runtime.JSONApiResponse(response, (jsonValue) => ReactionFromJSON(jsonValue));
    }
    async saveReaction(requestParameters, initOverrides) {
        const response = await this.saveReactionRaw(requestParameters, initOverrides);
        return await response.value();
    }
}
