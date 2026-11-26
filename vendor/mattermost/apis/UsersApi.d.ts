import * as runtime from '../runtime.js';
import { type SearchUsersRequest } from '../models/SearchUsersRequest.js';
import { type User } from '../models/User.js';
export interface GetProfileImageRequest {
    userId: string;
    u?: number;
}
export interface GetUserRequest {
    userId: string;
}
export interface GetUsersRequest {
    page?: number;
    perPage?: number;
    inTeam?: string;
    notInTeam?: string;
    inChannel?: string;
    notInChannel?: string;
    inGroup?: string;
    groupConstrained?: boolean;
    withoutTeam?: boolean;
    active?: boolean;
    inactive?: boolean;
    role?: string;
    sort?: string;
    roles?: string;
    channelRoles?: string;
    teamRoles?: string;
}
export interface GetUsersByIdsRequest {
    requestBody: Array<string>;
    since?: number;
}
export interface GetUsersByUsernamesRequest {
    requestBody: Array<string>;
}
export interface SearchUsersOperationRequest {
    searchUsersRequest: SearchUsersRequest;
}
export declare class UsersApi extends runtime.BaseAPI {
    getProfileImageRequestOpts(requestParameters: GetProfileImageRequest): Promise<runtime.RequestOpts>;
    getProfileImageRaw(requestParameters: GetProfileImageRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<runtime.ApiResponse<runtime.HttpFile>>;
    getProfileImage(requestParameters: GetProfileImageRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<runtime.HttpFile>;
    getUserRequestOpts(requestParameters: GetUserRequest): Promise<runtime.RequestOpts>;
    getUserRaw(requestParameters: GetUserRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<runtime.ApiResponse<User>>;
    getUser(requestParameters: GetUserRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<User>;
    getUsersRequestOpts(requestParameters: GetUsersRequest): Promise<runtime.RequestOpts>;
    getUsersRaw(requestParameters: GetUsersRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<runtime.ApiResponse<Array<User>>>;
    getUsers(requestParameters?: GetUsersRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<Array<User>>;
    getUsersByIdsRequestOpts(requestParameters: GetUsersByIdsRequest): Promise<runtime.RequestOpts>;
    getUsersByIdsRaw(requestParameters: GetUsersByIdsRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<runtime.ApiResponse<Array<User>>>;
    getUsersByIds(requestParameters: GetUsersByIdsRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<Array<User>>;
    getUsersByUsernamesRequestOpts(requestParameters: GetUsersByUsernamesRequest): Promise<runtime.RequestOpts>;
    getUsersByUsernamesRaw(requestParameters: GetUsersByUsernamesRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<runtime.ApiResponse<Array<User>>>;
    getUsersByUsernames(requestParameters: GetUsersByUsernamesRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<Array<User>>;
    searchUsersRequestOpts(requestParameters: SearchUsersOperationRequest): Promise<runtime.RequestOpts>;
    searchUsersRaw(requestParameters: SearchUsersOperationRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<runtime.ApiResponse<Array<User>>>;
    searchUsers(requestParameters: SearchUsersOperationRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<Array<User>>;
}
