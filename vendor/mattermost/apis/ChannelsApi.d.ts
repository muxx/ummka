import * as runtime from '../runtime.js';
import { type Channel } from '../models/Channel.js';
import { type ChannelMember } from '../models/ChannelMember.js';
import { type ChannelStats } from '../models/ChannelStats.js';
import { type MarkChannelsReadForUser200Response } from '../models/MarkChannelsReadForUser200Response.js';
import { type OrderedSidebarCategories } from '../models/OrderedSidebarCategories.js';
import { type ViewChannel200Response } from '../models/ViewChannel200Response.js';
import { type ViewChannelRequest } from '../models/ViewChannelRequest.js';
export interface GetChannelMemberRequest {
    channelId: string;
    userId: string;
}
export interface GetChannelMembersRequest {
    channelId: string;
    page?: number;
    perPage?: number;
}
export interface GetChannelMembersByIdsRequest {
    channelId: string;
    requestBody: Array<string>;
}
export interface GetChannelMembersForUserRequest {
    userId: string;
    teamId: string;
}
export interface GetChannelMembersTimezonesRequest {
    channelId: string;
}
export interface GetChannelStatsRequest {
    channelId: string;
    excludeFilesCount?: boolean;
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
    getChannelMemberRequestOpts(requestParameters: GetChannelMemberRequest): Promise<runtime.RequestOpts>;
    getChannelMemberRaw(requestParameters: GetChannelMemberRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<runtime.ApiResponse<ChannelMember>>;
    getChannelMember(requestParameters: GetChannelMemberRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<ChannelMember>;
    getChannelMembersRequestOpts(requestParameters: GetChannelMembersRequest): Promise<runtime.RequestOpts>;
    getChannelMembersRaw(requestParameters: GetChannelMembersRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<runtime.ApiResponse<Array<ChannelMember>>>;
    getChannelMembers(requestParameters: GetChannelMembersRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<Array<ChannelMember>>;
    getChannelMembersByIdsRequestOpts(requestParameters: GetChannelMembersByIdsRequest): Promise<runtime.RequestOpts>;
    getChannelMembersByIdsRaw(requestParameters: GetChannelMembersByIdsRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<runtime.ApiResponse<Array<ChannelMember>>>;
    getChannelMembersByIds(requestParameters: GetChannelMembersByIdsRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<Array<ChannelMember>>;
    getChannelMembersForUserRequestOpts(requestParameters: GetChannelMembersForUserRequest): Promise<runtime.RequestOpts>;
    getChannelMembersForUserRaw(requestParameters: GetChannelMembersForUserRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<runtime.ApiResponse<Array<ChannelMember>>>;
    getChannelMembersForUser(requestParameters: GetChannelMembersForUserRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<Array<ChannelMember>>;
    getChannelMembersTimezonesRequestOpts(requestParameters: GetChannelMembersTimezonesRequest): Promise<runtime.RequestOpts>;
    getChannelMembersTimezonesRaw(requestParameters: GetChannelMembersTimezonesRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<runtime.ApiResponse<Array<string> | null>>;
    getChannelMembersTimezones(requestParameters: GetChannelMembersTimezonesRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<Array<string> | null>;
    getChannelStatsRequestOpts(requestParameters: GetChannelStatsRequest): Promise<runtime.RequestOpts>;
    getChannelStatsRaw(requestParameters: GetChannelStatsRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<runtime.ApiResponse<ChannelStats>>;
    getChannelStats(requestParameters: GetChannelStatsRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<ChannelStats>;
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
