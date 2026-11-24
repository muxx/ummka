import * as runtime from '../runtime.js';
import { type SystemStatusResponse } from '../models/SystemStatusResponse.js';
export interface GetClientConfigRequest {
    format: string;
}
export interface GetClientLicenseRequest {
    format: string;
}
export interface GetPingRequest {
    getServerStatus?: boolean;
    deviceId?: string;
    useRestSemantics?: boolean;
}
export declare class SystemApi extends runtime.BaseAPI {
    getClientConfigRequestOpts(requestParameters: GetClientConfigRequest): Promise<runtime.RequestOpts>;
    getClientConfigRaw(requestParameters: GetClientConfigRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<runtime.ApiResponse<void>>;
    getClientConfig(requestParameters: GetClientConfigRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<void>;
    getClientLicenseRequestOpts(requestParameters: GetClientLicenseRequest): Promise<runtime.RequestOpts>;
    getClientLicenseRaw(requestParameters: GetClientLicenseRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<runtime.ApiResponse<void>>;
    getClientLicense(requestParameters: GetClientLicenseRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<void>;
    getPingRequestOpts(requestParameters: GetPingRequest): Promise<runtime.RequestOpts>;
    getPingRaw(requestParameters: GetPingRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<runtime.ApiResponse<SystemStatusResponse>>;
    getPing(requestParameters?: GetPingRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<SystemStatusResponse>;
}
