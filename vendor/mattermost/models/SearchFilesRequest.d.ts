export interface SearchFilesRequest {
    terms: string;
    isOrSearch: boolean;
    timeZoneOffset?: number;
    includeDeletedChannels?: boolean;
    page?: number;
    perPage?: number;
}
export declare function instanceOfSearchFilesRequest(value: object): value is SearchFilesRequest;
export declare function SearchFilesRequestFromJSON(json: any): SearchFilesRequest;
export declare function SearchFilesRequestFromJSONTyped(json: any, ignoreDiscriminator: boolean): SearchFilesRequest;
export declare function SearchFilesRequestToJSON(json: any): SearchFilesRequest;
export declare function SearchFilesRequestToJSONTyped(value?: SearchFilesRequest | null, ignoreDiscriminator?: boolean): any;
