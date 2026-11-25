import * as runtime from '../runtime.js';
import { type Role } from '../models/Role.js';
export interface GetRolesByNamesRequest {
    requestBody: Array<string>;
}
export declare class RolesApi extends runtime.BaseAPI {
    getRolesByNamesRequestOpts(requestParameters: GetRolesByNamesRequest): Promise<runtime.RequestOpts>;
    getRolesByNamesRaw(requestParameters: GetRolesByNamesRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<runtime.ApiResponse<Array<Role> | null>>;
    getRolesByNames(requestParameters: GetRolesByNamesRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<Array<Role> | null>;
}
