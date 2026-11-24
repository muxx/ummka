import * as runtime from '../runtime.js';
import { type SystemStatusResponse } from '../models/SystemStatusResponse.js';
export interface GetPingRequest {
    getServerStatus?: boolean;
    deviceId?: string;
    useRestSemantics?: boolean;
}
export declare class SystemApi extends runtime.BaseAPI {
    getPingRequestOpts(requestParameters: GetPingRequest): Promise<runtime.RequestOpts>;
    getPingRaw(requestParameters: GetPingRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<runtime.ApiResponse<SystemStatusResponse>>;
    getPing(requestParameters?: GetPingRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<SystemStatusResponse>;
}
