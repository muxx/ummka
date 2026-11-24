import * as runtime from '../runtime.js';
import { type Channel } from '../models/Channel.js';
import { type ChannelMember } from '../models/ChannelMember.js';
import { type OrderedSidebarCategories } from '../models/OrderedSidebarCategories.js';
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
}
