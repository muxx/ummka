import * as runtime from '../runtime.js';
import { type AutocompleteCommand } from '../models/AutocompleteCommand.js';
import { type AutocompleteSuggestion } from '../models/AutocompleteSuggestion.js';
import { type CommandResponse } from '../models/CommandResponse.js';
import { type ExecuteCommandRequest } from '../models/ExecuteCommandRequest.js';
export interface ExecuteCommandOperationRequest {
    executeCommandRequest: ExecuteCommandRequest;
}
export interface ListAutocompleteCommandsRequest {
    teamId: string;
}
export interface ListCommandAutocompleteSuggestionsRequest {
    teamId: string;
    userInput: string;
    channelId?: string;
    rootId?: string;
}
export declare class CommandsApi extends runtime.BaseAPI {
    executeCommandRequestOpts(requestParameters: ExecuteCommandOperationRequest): Promise<runtime.RequestOpts>;
    executeCommandRaw(requestParameters: ExecuteCommandOperationRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<runtime.ApiResponse<CommandResponse>>;
    executeCommand(requestParameters: ExecuteCommandOperationRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<CommandResponse>;
    listAutocompleteCommandsRequestOpts(requestParameters: ListAutocompleteCommandsRequest): Promise<runtime.RequestOpts>;
    listAutocompleteCommandsRaw(requestParameters: ListAutocompleteCommandsRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<runtime.ApiResponse<Array<AutocompleteCommand>>>;
    listAutocompleteCommands(requestParameters: ListAutocompleteCommandsRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<Array<AutocompleteCommand>>;
    listCommandAutocompleteSuggestionsRequestOpts(requestParameters: ListCommandAutocompleteSuggestionsRequest): Promise<runtime.RequestOpts>;
    listCommandAutocompleteSuggestionsRaw(requestParameters: ListCommandAutocompleteSuggestionsRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<runtime.ApiResponse<Array<AutocompleteSuggestion>>>;
    listCommandAutocompleteSuggestions(requestParameters: ListCommandAutocompleteSuggestionsRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<Array<AutocompleteSuggestion>>;
}
