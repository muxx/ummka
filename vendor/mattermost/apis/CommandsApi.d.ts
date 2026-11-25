import * as runtime from '../runtime.js';
import { type CommandResponse } from '../models/CommandResponse.js';
import { type ExecuteCommandRequest } from '../models/ExecuteCommandRequest.js';
export interface ExecuteCommandOperationRequest {
    executeCommandRequest: ExecuteCommandRequest;
}
export declare class CommandsApi extends runtime.BaseAPI {
    executeCommandRequestOpts(requestParameters: ExecuteCommandOperationRequest): Promise<runtime.RequestOpts>;
    executeCommandRaw(requestParameters: ExecuteCommandOperationRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<runtime.ApiResponse<CommandResponse>>;
    executeCommand(requestParameters: ExecuteCommandOperationRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<CommandResponse>;
}
