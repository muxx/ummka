import * as runtime from '../runtime.js';
import { type Team } from '../models/Team.js';
export interface GetTeamsForUserRequest {
    userId: string;
}
export declare class TeamsApi extends runtime.BaseAPI {
    getTeamsForUserRequestOpts(requestParameters: GetTeamsForUserRequest): Promise<runtime.RequestOpts>;
    getTeamsForUserRaw(requestParameters: GetTeamsForUserRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<runtime.ApiResponse<Array<Team>>>;
    getTeamsForUser(requestParameters: GetTeamsForUserRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<Array<Team>>;
}
