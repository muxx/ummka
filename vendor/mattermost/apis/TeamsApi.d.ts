import * as runtime from '../runtime.js';
import { type AddTeamMemberRequest } from '../models/AddTeamMemberRequest.js';
import { type StatusOK } from '../models/StatusOK.js';
import { type Team } from '../models/Team.js';
import { type TeamMember } from '../models/TeamMember.js';
export interface AddTeamMemberOperationRequest {
    teamId: string;
    addTeamMemberRequest: AddTeamMemberRequest;
}
export interface GetTeamByNameRequest {
    name: string;
}
export interface GetTeamMembersForUserRequest {
    userId: string;
}
export interface GetTeamsForUserRequest {
    userId: string;
}
export interface RemoveTeamMemberRequest {
    teamId: string;
    userId: string;
}
export declare class TeamsApi extends runtime.BaseAPI {
    addTeamMemberRequestOpts(requestParameters: AddTeamMemberOperationRequest): Promise<runtime.RequestOpts>;
    addTeamMemberRaw(requestParameters: AddTeamMemberOperationRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<runtime.ApiResponse<TeamMember>>;
    addTeamMember(requestParameters: AddTeamMemberOperationRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<TeamMember>;
    getTeamByNameRequestOpts(requestParameters: GetTeamByNameRequest): Promise<runtime.RequestOpts>;
    getTeamByNameRaw(requestParameters: GetTeamByNameRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<runtime.ApiResponse<Team>>;
    getTeamByName(requestParameters: GetTeamByNameRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<Team>;
    getTeamMembersForUserRequestOpts(requestParameters: GetTeamMembersForUserRequest): Promise<runtime.RequestOpts>;
    getTeamMembersForUserRaw(requestParameters: GetTeamMembersForUserRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<runtime.ApiResponse<Array<TeamMember>>>;
    getTeamMembersForUser(requestParameters: GetTeamMembersForUserRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<Array<TeamMember>>;
    getTeamsForUserRequestOpts(requestParameters: GetTeamsForUserRequest): Promise<runtime.RequestOpts>;
    getTeamsForUserRaw(requestParameters: GetTeamsForUserRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<runtime.ApiResponse<Array<Team>>>;
    getTeamsForUser(requestParameters: GetTeamsForUserRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<Array<Team>>;
    removeTeamMemberRequestOpts(requestParameters: RemoveTeamMemberRequest): Promise<runtime.RequestOpts>;
    removeTeamMemberRaw(requestParameters: RemoveTeamMemberRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<runtime.ApiResponse<StatusOK>>;
    removeTeamMember(requestParameters: RemoveTeamMemberRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<StatusOK>;
}
