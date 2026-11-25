import * as runtime from '../runtime.js';
import { type GetGroupsAssociatedToChannelsByTeam200Response } from '../models/GetGroupsAssociatedToChannelsByTeam200Response.js';
import { type GetGroupsByTeam200Response } from '../models/GetGroupsByTeam200Response.js';
import { type Group } from '../models/Group.js';
export interface GetGroupsRequest {
    page?: number;
    perPage?: number;
    q?: string;
    includeMemberCount?: boolean;
    notAssociatedToTeam?: string;
    notAssociatedToChannel?: string;
    since?: number;
    filterAllowReference?: boolean;
}
export interface GetGroupsAssociatedToChannelsByTeamRequest {
    teamId: string;
    page?: number;
    perPage?: number;
    filterAllowReference?: boolean;
    includeMemberCount?: boolean;
    paginate?: boolean;
    q?: string;
}
export interface GetGroupsByTeamRequest {
    teamId: string;
    page?: number;
    perPage?: number;
    filterAllowReference?: boolean;
    includeMemberCount?: boolean;
    paginate?: boolean;
    q?: string;
}
export declare class GroupsApi extends runtime.BaseAPI {
    getGroupsRequestOpts(requestParameters: GetGroupsRequest): Promise<runtime.RequestOpts>;
    getGroupsRaw(requestParameters: GetGroupsRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<runtime.ApiResponse<Array<Group>>>;
    getGroups(requestParameters?: GetGroupsRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<Array<Group>>;
    getGroupsAssociatedToChannelsByTeamRequestOpts(requestParameters: GetGroupsAssociatedToChannelsByTeamRequest): Promise<runtime.RequestOpts>;
    getGroupsAssociatedToChannelsByTeamRaw(requestParameters: GetGroupsAssociatedToChannelsByTeamRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<runtime.ApiResponse<GetGroupsAssociatedToChannelsByTeam200Response>>;
    getGroupsAssociatedToChannelsByTeam(requestParameters: GetGroupsAssociatedToChannelsByTeamRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<GetGroupsAssociatedToChannelsByTeam200Response>;
    getGroupsByTeamRequestOpts(requestParameters: GetGroupsByTeamRequest): Promise<runtime.RequestOpts>;
    getGroupsByTeamRaw(requestParameters: GetGroupsByTeamRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<runtime.ApiResponse<GetGroupsByTeam200Response>>;
    getGroupsByTeam(requestParameters: GetGroupsByTeamRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<GetGroupsByTeam200Response>;
}
