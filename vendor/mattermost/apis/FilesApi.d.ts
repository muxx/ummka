import * as runtime from '../runtime.js';
import { type FileInfo } from '../models/FileInfo.js';
import { type FileInfoList } from '../models/FileInfoList.js';
import { type SearchFilesInAllTeamsRequest } from '../models/SearchFilesInAllTeamsRequest.js';
import { type SearchFilesRequest } from '../models/SearchFilesRequest.js';
export interface GetFileInfoRequest {
    fileId: string;
}
export interface SearchFilesOperationRequest {
    teamId: string;
    searchFilesRequest: SearchFilesRequest;
}
export interface SearchFilesInAllTeamsOperationRequest {
    searchFilesInAllTeamsRequest: SearchFilesInAllTeamsRequest;
}
export declare class FilesApi extends runtime.BaseAPI {
    getFileInfoRequestOpts(requestParameters: GetFileInfoRequest): Promise<runtime.RequestOpts>;
    getFileInfoRaw(requestParameters: GetFileInfoRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<runtime.ApiResponse<FileInfo>>;
    getFileInfo(requestParameters: GetFileInfoRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<FileInfo>;
    searchFilesRequestOpts(requestParameters: SearchFilesOperationRequest): Promise<runtime.RequestOpts>;
    searchFilesRaw(requestParameters: SearchFilesOperationRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<runtime.ApiResponse<FileInfoList>>;
    searchFiles(requestParameters: SearchFilesOperationRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<FileInfoList>;
    searchFilesInAllTeamsRequestOpts(requestParameters: SearchFilesInAllTeamsOperationRequest): Promise<runtime.RequestOpts>;
    searchFilesInAllTeamsRaw(requestParameters: SearchFilesInAllTeamsOperationRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<runtime.ApiResponse<FileInfoList>>;
    searchFilesInAllTeams(requestParameters: SearchFilesInAllTeamsOperationRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<FileInfoList>;
}
