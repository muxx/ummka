import * as runtime from '../runtime.js';
import { type Channel } from '../models/Channel.js';
import { type ChannelMember } from '../models/ChannelMember.js';
import { type MarkChannelsReadForUser200Response } from '../models/MarkChannelsReadForUser200Response.js';
import { type OrderedSidebarCategories } from '../models/OrderedSidebarCategories.js';
import { type ViewChannel200Response } from '../models/ViewChannel200Response.js';
import { type ViewChannelRequest } from '../models/ViewChannelRequest.js';
export interface GetChannelMembersForUserRequest {
    userId: string;
    teamId: string;
}
export interface GetChannelsForTeamForUserRequest {
    userId: string;
    teamId: string;
    includeDeleted?: boolean;
    lastDeleteAt?: number;
}
export interface GetSidebarCategoriesForTeamForUserRequest {
    teamId: string;
    userId: string;
}
export interface MarkChannelsReadForUserRequest {
    userId: string;
    requestBody: Array<string>;
}
export interface ViewChannelOperationRequest {
    userId: string;
    viewChannelRequest: ViewChannelRequest;
}
export declare class ChannelsApi extends runtime.BaseAPI {
    getChannelMembersForUserRequestOpts(requestParameters: GetChannelMembersForUserRequest): Promise<runtime.RequestOpts>;
    getChannelMembersForUserRaw(requestParameters: GetChannelMembersForUserRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<runtime.ApiResponse<Array<ChannelMember>>>;
    getChannelMembersForUser(requestParameters: GetChannelMembersForUserRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<Array<ChannelMember>>;
    getChannelsForTeamForUserRequestOpts(requestParameters: GetChannelsForTeamForUserRequest): Promise<runtime.RequestOpts>;
    getChannelsForTeamForUserRaw(requestParameters: GetChannelsForTeamForUserRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<runtime.ApiResponse<Array<Channel>>>;
    getChannelsForTeamForUser(requestParameters: GetChannelsForTeamForUserRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<Array<Channel>>;
    getSidebarCategoriesForTeamForUserRequestOpts(requestParameters: GetSidebarCategoriesForTeamForUserRequest): Promise<runtime.RequestOpts>;
    getSidebarCategoriesForTeamForUserRaw(requestParameters: GetSidebarCategoriesForTeamForUserRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<runtime.ApiResponse<OrderedSidebarCategories>>;
    getSidebarCategoriesForTeamForUser(requestParameters: GetSidebarCategoriesForTeamForUserRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<OrderedSidebarCategories>;
    markChannelsReadForUserRequestOpts(requestParameters: MarkChannelsReadForUserRequest): Promise<runtime.RequestOpts>;
    markChannelsReadForUserRaw(requestParameters: MarkChannelsReadForUserRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<runtime.ApiResponse<MarkChannelsReadForUser200Response>>;
    markChannelsReadForUser(requestParameters: MarkChannelsReadForUserRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<MarkChannelsReadForUser200Response>;
    viewChannelRequestOpts(requestParameters: ViewChannelOperationRequest): Promise<runtime.RequestOpts>;
    viewChannelRaw(requestParameters: ViewChannelOperationRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<runtime.ApiResponse<ViewChannel200Response>>;
    viewChannel(requestParameters: ViewChannelOperationRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<ViewChannel200Response>;
}
