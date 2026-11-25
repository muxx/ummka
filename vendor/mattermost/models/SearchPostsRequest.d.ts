export interface SearchPostsRequest {
    terms: string;
    isOrSearch: boolean;
    timeZoneOffset?: number;
    includeDeletedChannels?: boolean;
    page?: number;
    perPage?: number;
}
export declare function instanceOfSearchPostsRequest(value: object): value is SearchPostsRequest;
export declare function SearchPostsRequestFromJSON(json: any): SearchPostsRequest;
export declare function SearchPostsRequestFromJSONTyped(json: any, ignoreDiscriminator: boolean): SearchPostsRequest;
export declare function SearchPostsRequestToJSON(json: any): SearchPostsRequest;
export declare function SearchPostsRequestToJSONTyped(value?: SearchPostsRequest | null, ignoreDiscriminator?: boolean): any;
