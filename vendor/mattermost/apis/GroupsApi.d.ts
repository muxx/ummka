import * as runtime from '../runtime.js';
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
export declare class GroupsApi extends runtime.BaseAPI {
    getGroupsRequestOpts(requestParameters: GetGroupsRequest): Promise<runtime.RequestOpts>;
    getGroupsRaw(requestParameters: GetGroupsRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<runtime.ApiResponse<Array<Group>>>;
    getGroups(requestParameters?: GetGroupsRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<Array<Group>>;
}
