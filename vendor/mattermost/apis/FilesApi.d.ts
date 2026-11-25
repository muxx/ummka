import * as runtime from '../runtime.js';
import { type FileInfoList } from '../models/FileInfoList.js';
import { type SearchFilesInAllTeamsRequest } from '../models/SearchFilesInAllTeamsRequest.js';
import { type SearchFilesRequest } from '../models/SearchFilesRequest.js';
export interface SearchFilesOperationRequest {
    teamId: string;
    searchFilesRequest: SearchFilesRequest;
}
export interface SearchFilesInAllTeamsOperationRequest {
    searchFilesInAllTeamsRequest: SearchFilesInAllTeamsRequest;
}
export declare class FilesApi extends runtime.BaseAPI {
    searchFilesRequestOpts(requestParameters: SearchFilesOperationRequest): Promise<runtime.RequestOpts>;
    searchFilesRaw(requestParameters: SearchFilesOperationRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<runtime.ApiResponse<FileInfoList>>;
    searchFiles(requestParameters: SearchFilesOperationRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<FileInfoList>;
    searchFilesInAllTeamsRequestOpts(requestParameters: SearchFilesInAllTeamsOperationRequest): Promise<runtime.RequestOpts>;
    searchFilesInAllTeamsRaw(requestParameters: SearchFilesInAllTeamsOperationRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<runtime.ApiResponse<FileInfoList>>;
    searchFilesInAllTeams(requestParameters: SearchFilesInAllTeamsOperationRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<FileInfoList>;
}
