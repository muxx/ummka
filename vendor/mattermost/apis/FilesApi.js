import * as runtime from '../runtime.js';
import { FileInfoFromJSON, } from '../models/FileInfo.js';
import { FileInfoListFromJSON, } from '../models/FileInfoList.js';
import { SearchFilesInAllTeamsRequestToJSON, } from '../models/SearchFilesInAllTeamsRequest.js';
import { SearchFilesRequestToJSON, } from '../models/SearchFilesRequest.js';
export class FilesApi extends runtime.BaseAPI {
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
}
