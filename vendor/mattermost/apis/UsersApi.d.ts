import * as runtime from '../runtime.js';
import { type User } from '../models/User.js';
export interface GetUserRequest {
    userId: string;
}
export interface GetUsersByIdsRequest {
    requestBody: Array<string>;
    since?: number;
}
export declare class UsersApi extends runtime.BaseAPI {
    getUserRequestOpts(requestParameters: GetUserRequest): Promise<runtime.RequestOpts>;
    getUserRaw(requestParameters: GetUserRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<runtime.ApiResponse<User>>;
    getUser(requestParameters: GetUserRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<User>;
    getUsersByIdsRequestOpts(requestParameters: GetUsersByIdsRequest): Promise<runtime.RequestOpts>;
    getUsersByIdsRaw(requestParameters: GetUsersByIdsRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<runtime.ApiResponse<Array<User>>>;
    getUsersByIds(requestParameters: GetUsersByIdsRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<Array<User>>;
}
