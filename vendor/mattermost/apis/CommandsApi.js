import * as runtime from '../runtime.js';
import { AutocompleteCommandFromJSON, } from '../models/AutocompleteCommand.js';
import { AutocompleteSuggestionFromJSON, } from '../models/AutocompleteSuggestion.js';
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
    async listAutocompleteCommandsRequestOpts(requestParameters) {
        if (requestParameters['teamId'] == null) {
            throw new runtime.RequiredError('teamId', 'Required parameter "teamId" was null or undefined when calling listAutocompleteCommands().');
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
        let urlPath = `/api/v4/teams/{team_id}/commands/autocomplete`;
        urlPath = urlPath.replace('{team_id}', encodeURIComponent(String(requestParameters['teamId'])));
        return {
            path: urlPath,
            method: 'GET',
            headers: headerParameters,
            query: queryParameters,
        };
    }
    async listAutocompleteCommandsRaw(requestParameters, initOverrides) {
        const requestOptions = await this.listAutocompleteCommandsRequestOpts(requestParameters);
        const response = await this.request(requestOptions, initOverrides);
        return new runtime.JSONApiResponse(response, (jsonValue) => jsonValue.map(AutocompleteCommandFromJSON));
    }
    async listAutocompleteCommands(requestParameters, initOverrides) {
        const response = await this.listAutocompleteCommandsRaw(requestParameters, initOverrides);
        return await response.value();
    }
    async listCommandAutocompleteSuggestionsRequestOpts(requestParameters) {
        if (requestParameters['teamId'] == null) {
            throw new runtime.RequiredError('teamId', 'Required parameter "teamId" was null or undefined when calling listCommandAutocompleteSuggestions().');
        }
        if (requestParameters['userInput'] == null) {
            throw new runtime.RequiredError('userInput', 'Required parameter "userInput" was null or undefined when calling listCommandAutocompleteSuggestions().');
        }
        const queryParameters = {};
        if (requestParameters['userInput'] != null) {
            queryParameters['user_input'] = requestParameters['userInput'];
        }
        if (requestParameters['channelId'] != null) {
            queryParameters['channel_id'] = requestParameters['channelId'];
        }
        if (requestParameters['rootId'] != null) {
            queryParameters['root_id'] = requestParameters['rootId'];
        }
        const headerParameters = {};
        if (this.configuration && this.configuration.accessToken) {
            const token = this.configuration.accessToken;
            const tokenString = await token("bearerAuth", []);
            if (tokenString) {
                headerParameters["Authorization"] = `Bearer ${tokenString}`;
            }
        }
        let urlPath = `/api/v4/teams/{team_id}/commands/autocomplete_suggestions`;
        urlPath = urlPath.replace('{team_id}', encodeURIComponent(String(requestParameters['teamId'])));
        return {
            path: urlPath,
            method: 'GET',
            headers: headerParameters,
            query: queryParameters,
        };
    }
    async listCommandAutocompleteSuggestionsRaw(requestParameters, initOverrides) {
        const requestOptions = await this.listCommandAutocompleteSuggestionsRequestOpts(requestParameters);
        const response = await this.request(requestOptions, initOverrides);
        return new runtime.JSONApiResponse(response, (jsonValue) => jsonValue.map(AutocompleteSuggestionFromJSON));
    }
    async listCommandAutocompleteSuggestions(requestParameters, initOverrides) {
        const response = await this.listCommandAutocompleteSuggestionsRaw(requestParameters, initOverrides);
        return await response.value();
    }
}
