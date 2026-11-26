export interface SearchUsersRequest {
    term: string;
    teamId?: string;
    notInTeamId?: string;
    inChannelId?: string;
    notInChannelId?: string;
    inGroupId?: string;
    groupConstrained?: boolean;
    allowInactive?: boolean;
    withoutTeam?: boolean;
    limit?: number;
}
export declare function instanceOfSearchUsersRequest(value: object): value is SearchUsersRequest;
export declare function SearchUsersRequestFromJSON(json: any): SearchUsersRequest;
export declare function SearchUsersRequestFromJSONTyped(json: any, ignoreDiscriminator: boolean): SearchUsersRequest;
export declare function SearchUsersRequestToJSON(json: any): SearchUsersRequest;
export declare function SearchUsersRequestToJSONTyped(value?: SearchUsersRequest | null, ignoreDiscriminator?: boolean): any;
