export interface SearchFilesInAllTeamsRequest {
    terms: string;
    isOrSearch: boolean;
    timeZoneOffset?: number;
    includeDeletedChannels?: boolean;
    page?: number;
    perPage?: number;
}
export declare function instanceOfSearchFilesInAllTeamsRequest(value: object): value is SearchFilesInAllTeamsRequest;
export declare function SearchFilesInAllTeamsRequestFromJSON(json: any): SearchFilesInAllTeamsRequest;
export declare function SearchFilesInAllTeamsRequestFromJSONTyped(json: any, ignoreDiscriminator: boolean): SearchFilesInAllTeamsRequest;
export declare function SearchFilesInAllTeamsRequestToJSON(json: any): SearchFilesInAllTeamsRequest;
export declare function SearchFilesInAllTeamsRequestToJSONTyped(value?: SearchFilesInAllTeamsRequest | null, ignoreDiscriminator?: boolean): any;
