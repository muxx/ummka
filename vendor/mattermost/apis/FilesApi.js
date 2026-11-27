import * as runtime from '../runtime.js';
import { FileInfoFromJSON, } from '../models/FileInfo.js';
import { FileInfoListFromJSON, } from '../models/FileInfoList.js';
import { SearchFilesInAllTeamsRequestToJSON, } from '../models/SearchFilesInAllTeamsRequest.js';
import { SearchFilesRequestToJSON, } from '../models/SearchFilesRequest.js';
import { UploadFile201ResponseFromJSON, } from '../models/UploadFile201Response.js';
export class FilesApi extends runtime.BaseAPI {
    async getFileRequestOpts(requestParameters) {
        if (requestParameters['fileId'] == null) {
            throw new runtime.RequiredError('fileId', 'Required parameter "fileId" was null or undefined when calling getFile().');
        }
        const queryParameters = {};
        const headerParameters = {};
        if (requestParameters['range'] != null) {
            headerParameters['Range'] = String(requestParameters['range']);
        }
        if (this.configuration && this.configuration.accessToken) {
            const token = this.configuration.accessToken;
            const tokenString = await token("bearerAuth", []);
            if (tokenString) {
                headerParameters["Authorization"] = `Bearer ${tokenString}`;
            }
        }
        let urlPath = `/api/v4/files/{file_id}`;
        urlPath = urlPath.replace('{file_id}', encodeURIComponent(String(requestParameters['fileId'])));
        return {
            path: urlPath,
            method: 'GET',
            headers: headerParameters,
            query: queryParameters,
        };
    }
    async getFileRaw(requestParameters, initOverrides) {
        const requestOptions = await this.getFileRequestOpts(requestParameters);
        const response = await this.request(requestOptions, initOverrides);
        return new runtime.BlobApiResponse(response);
    }
    async getFile(requestParameters, initOverrides) {
        const response = await this.getFileRaw(requestParameters, initOverrides);
        return await response.value();
    }
    async getFileInfoRequestOpts(requestParameters) {
        if (requestParameters['fileId'] == null) {
            throw new runtime.RequiredError('fileId', 'Required parameter "fileId" was null or undefined when calling getFileInfo().');
        }
        const queryParameters = {};
        const headerParameters = {};
        if (this.configuration && this.configuration.accessToken) {
            const token = this.configuration.accessToken;
            const tokenString = await token("bearerAuth", []);
            if (tokenString) {
                headerParameters["Authorization"] = `Bearer ${tokenString}`;
            }
        }
        let urlPath = `/api/v4/files/{file_id}/info`;
        urlPath = urlPath.replace('{file_id}', encodeURIComponent(String(requestParameters['fileId'])));
        return {
            path: urlPath,
            method: 'GET',
            headers: headerParameters,
            query: queryParameters,
        };
    }
    async getFileInfoRaw(requestParameters, initOverrides) {
        const requestOptions = await this.getFileInfoRequestOpts(requestParameters);
        const response = await this.request(requestOptions, initOverrides);
        return new runtime.JSONApiResponse(response, (jsonValue) => FileInfoFromJSON(jsonValue));
    }
    async getFileInfo(requestParameters, initOverrides) {
        const response = await this.getFileInfoRaw(requestParameters, initOverrides);
        return await response.value();
    }
    async getFilePreviewRequestOpts(requestParameters) {
        if (requestParameters['fileId'] == null) {
            throw new runtime.RequiredError('fileId', 'Required parameter "fileId" was null or undefined when calling getFilePreview().');
        }
        const queryParameters = {};
        const headerParameters = {};
        if (requestParameters['range'] != null) {
            headerParameters['Range'] = String(requestParameters['range']);
        }
        if (this.configuration && this.configuration.accessToken) {
            const token = this.configuration.accessToken;
            const tokenString = await token("bearerAuth", []);
            if (tokenString) {
                headerParameters["Authorization"] = `Bearer ${tokenString}`;
            }
        }
        let urlPath = `/api/v4/files/{file_id}/preview`;
        urlPath = urlPath.replace('{file_id}', encodeURIComponent(String(requestParameters['fileId'])));
        return {
            path: urlPath,
            method: 'GET',
            headers: headerParameters,
            query: queryParameters,
        };
    }
    async getFilePreviewRaw(requestParameters, initOverrides) {
        const requestOptions = await this.getFilePreviewRequestOpts(requestParameters);
        const response = await this.request(requestOptions, initOverrides);
        return new runtime.BlobApiResponse(response);
    }
    async getFilePreview(requestParameters, initOverrides) {
        const response = await this.getFilePreviewRaw(requestParameters, initOverrides);
        return await response.value();
    }
    async getFileThumbnailRequestOpts(requestParameters) {
        if (requestParameters['fileId'] == null) {
            throw new runtime.RequiredError('fileId', 'Required parameter "fileId" was null or undefined when calling getFileThumbnail().');
        }
        const queryParameters = {};
        const headerParameters = {};
        if (requestParameters['range'] != null) {
            headerParameters['Range'] = String(requestParameters['range']);
        }
        if (this.configuration && this.configuration.accessToken) {
            const token = this.configuration.accessToken;
            const tokenString = await token("bearerAuth", []);
            if (tokenString) {
                headerParameters["Authorization"] = `Bearer ${tokenString}`;
            }
        }
        let urlPath = `/api/v4/files/{file_id}/thumbnail`;
        urlPath = urlPath.replace('{file_id}', encodeURIComponent(String(requestParameters['fileId'])));
        return {
            path: urlPath,
            method: 'GET',
            headers: headerParameters,
            query: queryParameters,
        };
    }
    async getFileThumbnailRaw(requestParameters, initOverrides) {
        const requestOptions = await this.getFileThumbnailRequestOpts(requestParameters);
        const response = await this.request(requestOptions, initOverrides);
        return new runtime.BlobApiResponse(response);
    }
    async getFileThumbnail(requestParameters, initOverrides) {
        const response = await this.getFileThumbnailRaw(requestParameters, initOverrides);
        return await response.value();
    }
    async searchFilesRequestOpts(requestParameters) {
        if (requestParameters['teamId'] == null) {
            throw new runtime.RequiredError('teamId', 'Required parameter "teamId" was null or undefined when calling searchFiles().');
        }
        if (requestParameters['searchFilesRequest'] == null) {
            throw new runtime.RequiredError('searchFilesRequest', 'Required parameter "searchFilesRequest" was null or undefined when calling searchFiles().');
        }
        const queryParameters = {};
        const headerParameters = {};
        headerParameters['Content-Type'] = 'application/json';
        if (this.configuration && this.configuration.accessToken) {
            const token = this.configuration.accessToken;
            const tokenString = await token("bearerAuth", []);
            if (tokenString) {
                headerParameters["Authorization"] = `Bearer ${tokenString}`;
            }
        }
        let urlPath = `/api/v4/teams/{team_id}/files/search`;
        urlPath = urlPath.replace('{team_id}', encodeURIComponent(String(requestParameters['teamId'])));
        return {
            path: urlPath,
            method: 'POST',
            headers: headerParameters,
            query: queryParameters,
            body: SearchFilesRequestToJSON(requestParameters['searchFilesRequest']),
        };
    }
    async searchFilesRaw(requestParameters, initOverrides) {
        const requestOptions = await this.searchFilesRequestOpts(requestParameters);
        const response = await this.request(requestOptions, initOverrides);
        return new runtime.JSONApiResponse(response, (jsonValue) => FileInfoListFromJSON(jsonValue));
    }
    async searchFiles(requestParameters, initOverrides) {
        const response = await this.searchFilesRaw(requestParameters, initOverrides);
        return await response.value();
    }
    async searchFilesInAllTeamsRequestOpts(requestParameters) {
        if (requestParameters['searchFilesInAllTeamsRequest'] == null) {
            throw new runtime.RequiredError('searchFilesInAllTeamsRequest', 'Required parameter "searchFilesInAllTeamsRequest" was null or undefined when calling searchFilesInAllTeams().');
        }
        const queryParameters = {};
        const headerParameters = {};
        headerParameters['Content-Type'] = 'application/json';
        if (this.configuration && this.configuration.accessToken) {
            const token = this.configuration.accessToken;
            const tokenString = await token("bearerAuth", []);
            if (tokenString) {
                headerParameters["Authorization"] = `Bearer ${tokenString}`;
            }
        }
        let urlPath = `/api/v4/files/search`;
        return {
            path: urlPath,
            method: 'POST',
            headers: headerParameters,
            query: queryParameters,
            body: SearchFilesInAllTeamsRequestToJSON(requestParameters['searchFilesInAllTeamsRequest']),
        };
    }
    async searchFilesInAllTeamsRaw(requestParameters, initOverrides) {
        const requestOptions = await this.searchFilesInAllTeamsRequestOpts(requestParameters);
        const response = await this.request(requestOptions, initOverrides);
        return new runtime.JSONApiResponse(response, (jsonValue) => FileInfoListFromJSON(jsonValue));
    }
    async searchFilesInAllTeams(requestParameters, initOverrides) {
        const response = await this.searchFilesInAllTeamsRaw(requestParameters, initOverrides);
        return await response.value();
    }
    async uploadFileRequestOpts(requestParameters) {
        if (requestParameters['channelId'] == null) {
            throw new runtime.RequiredError('channelId', 'Required parameter "channelId" was null or undefined when calling uploadFile().');
        }
        if (requestParameters['clientIds'] == null) {
            throw new runtime.RequiredError('clientIds', 'Required parameter "clientIds" was null or undefined when calling uploadFile().');
        }
        if (requestParameters['files'] == null) {
            throw new runtime.RequiredError('files', 'Required parameter "files" was null or undefined when calling uploadFile().');
        }
        const queryParameters = {};
        if (requestParameters['bookmark'] != null) {
            queryParameters['bookmark'] = requestParameters['bookmark'];
        }
        const headerParameters = {};
        if (this.configuration && this.configuration.accessToken) {
            const token = this.configuration.accessToken;
            const tokenString = await token("bearerAuth", []);
            if (tokenString) {
                headerParameters["Authorization"] = `Bearer ${tokenString}`;
            }
        }
        const consumes = [
            { contentType: 'multipart/form-data' },
        ];
        const canConsumeForm = runtime.canConsumeForm(consumes);
        let formParams;
        let useForm = false;
        useForm = canConsumeForm;
        if (useForm) {
            formParams = new FormData();
        }
        else {
            formParams = new URLSearchParams();
        }
        if (requestParameters['channelId'] != null) {
            formParams.append('channel_id', requestParameters['channelId']);
        }
        if (requestParameters['clientIds'] != null) {
            formParams.append('client_ids', requestParameters['clientIds']);
        }
        if (requestParameters['files'] != null) {
            formParams.append('files', requestParameters['files']);
        }
        let urlPath = `/api/v4/files`;
        return {
            path: urlPath,
            method: 'POST',
            headers: headerParameters,
            query: queryParameters,
            body: formParams,
        };
    }
    async uploadFileRaw(requestParameters, initOverrides) {
        const requestOptions = await this.uploadFileRequestOpts(requestParameters);
        const response = await this.request(requestOptions, initOverrides);
        return new runtime.JSONApiResponse(response, (jsonValue) => UploadFile201ResponseFromJSON(jsonValue));
    }
    async uploadFile(requestParameters, initOverrides) {
        const response = await this.uploadFileRaw(requestParameters, initOverrides);
        return await response.value();
    }
}
