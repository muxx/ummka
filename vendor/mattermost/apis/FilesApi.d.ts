import * as runtime from '../runtime.js';
import { type FileInfo } from '../models/FileInfo.js';
import { type FileInfoList } from '../models/FileInfoList.js';
import { type SearchFilesInAllTeamsRequest } from '../models/SearchFilesInAllTeamsRequest.js';
import { type SearchFilesRequest } from '../models/SearchFilesRequest.js';
import { type UploadFile201Response } from '../models/UploadFile201Response.js';
export interface GetFileRequest {
    fileId: string;
    range?: string;
}
export interface GetFileInfoRequest {
    fileId: string;
}
export interface GetFilePreviewRequest {
    fileId: string;
    range?: string;
}
export interface GetFileThumbnailRequest {
    fileId: string;
    range?: string;
}
export interface SearchFilesOperationRequest {
    teamId: string;
    searchFilesRequest: SearchFilesRequest;
}
export interface SearchFilesInAllTeamsOperationRequest {
    searchFilesInAllTeamsRequest: SearchFilesInAllTeamsRequest;
}
export interface UploadFileRequest {
    channelId: string;
    clientIds: string;
    files: Blob;
    bookmark?: boolean;
}
export declare class FilesApi extends runtime.BaseAPI {
    getFileRequestOpts(requestParameters: GetFileRequest): Promise<runtime.RequestOpts>;
    getFileRaw(requestParameters: GetFileRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<runtime.ApiResponse<runtime.HttpFile>>;
    getFile(requestParameters: GetFileRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<runtime.HttpFile>;
    getFileInfoRequestOpts(requestParameters: GetFileInfoRequest): Promise<runtime.RequestOpts>;
    getFileInfoRaw(requestParameters: GetFileInfoRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<runtime.ApiResponse<FileInfo>>;
    getFileInfo(requestParameters: GetFileInfoRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<FileInfo>;
    getFilePreviewRequestOpts(requestParameters: GetFilePreviewRequest): Promise<runtime.RequestOpts>;
    getFilePreviewRaw(requestParameters: GetFilePreviewRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<runtime.ApiResponse<runtime.HttpFile>>;
    getFilePreview(requestParameters: GetFilePreviewRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<runtime.HttpFile>;
    getFileThumbnailRequestOpts(requestParameters: GetFileThumbnailRequest): Promise<runtime.RequestOpts>;
    getFileThumbnailRaw(requestParameters: GetFileThumbnailRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<runtime.ApiResponse<runtime.HttpFile>>;
    getFileThumbnail(requestParameters: GetFileThumbnailRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<runtime.HttpFile>;
    searchFilesRequestOpts(requestParameters: SearchFilesOperationRequest): Promise<runtime.RequestOpts>;
    searchFilesRaw(requestParameters: SearchFilesOperationRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<runtime.ApiResponse<FileInfoList>>;
    searchFiles(requestParameters: SearchFilesOperationRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<FileInfoList>;
    searchFilesInAllTeamsRequestOpts(requestParameters: SearchFilesInAllTeamsOperationRequest): Promise<runtime.RequestOpts>;
    searchFilesInAllTeamsRaw(requestParameters: SearchFilesInAllTeamsOperationRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<runtime.ApiResponse<FileInfoList>>;
    searchFilesInAllTeams(requestParameters: SearchFilesInAllTeamsOperationRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<FileInfoList>;
    uploadFileRequestOpts(requestParameters: UploadFileRequest): Promise<runtime.RequestOpts>;
    uploadFileRaw(requestParameters: UploadFileRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<runtime.ApiResponse<UploadFile201Response>>;
    uploadFile(requestParameters: UploadFileRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<UploadFile201Response>;
}
