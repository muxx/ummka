import * as runtime from '../runtime.js';
import { type CanUserDirectMessage200Response } from '../models/CanUserDirectMessage200Response.js';
export interface CanUserDirectMessageRequest {
    userId: string;
    otherUserId: string;
}
export declare class SharedChannelsApi extends runtime.BaseAPI {
    canUserDirectMessageRequestOpts(requestParameters: CanUserDirectMessageRequest): Promise<runtime.RequestOpts>;
    canUserDirectMessageRaw(requestParameters: CanUserDirectMessageRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<runtime.ApiResponse<CanUserDirectMessage200Response>>;
    canUserDirectMessage(requestParameters: CanUserDirectMessageRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<CanUserDirectMessage200Response>;
}
