import * as runtime from '../runtime.js';
import { type Team } from '../models/Team.js';
import { type TeamMember } from '../models/TeamMember.js';
export interface GetTeamMembersForUserRequest {
    userId: string;
}
export interface GetTeamsForUserRequest {
    userId: string;
}
export declare class TeamsApi extends runtime.BaseAPI {
    getTeamMembersForUserRequestOpts(requestParameters: GetTeamMembersForUserRequest): Promise<runtime.RequestOpts>;
    getTeamMembersForUserRaw(requestParameters: GetTeamMembersForUserRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<runtime.ApiResponse<Array<TeamMember>>>;
    getTeamMembersForUser(requestParameters: GetTeamMembersForUserRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<Array<TeamMember>>;
    getTeamsForUserRequestOpts(requestParameters: GetTeamsForUserRequest): Promise<runtime.RequestOpts>;
    getTeamsForUserRaw(requestParameters: GetTeamsForUserRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<runtime.ApiResponse<Array<Team>>>;
    getTeamsForUser(requestParameters: GetTeamsForUserRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<Array<Team>>;
}
