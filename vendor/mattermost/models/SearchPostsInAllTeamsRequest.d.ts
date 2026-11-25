export interface SearchPostsInAllTeamsRequest {
    terms: string;
    isOrSearch?: boolean;
    timeZoneOffset?: number;
    includeDeletedChannels?: boolean;
    page?: number;
    perPage?: number;
}
export declare function instanceOfSearchPostsInAllTeamsRequest(value: object): value is SearchPostsInAllTeamsRequest;
export declare function SearchPostsInAllTeamsRequestFromJSON(json: any): SearchPostsInAllTeamsRequest;
export declare function SearchPostsInAllTeamsRequestFromJSONTyped(json: any, ignoreDiscriminator: boolean): SearchPostsInAllTeamsRequest;
export declare function SearchPostsInAllTeamsRequestToJSON(json: any): SearchPostsInAllTeamsRequest;
export declare function SearchPostsInAllTeamsRequestToJSONTyped(value?: SearchPostsInAllTeamsRequest | null, ignoreDiscriminator?: boolean): any;
