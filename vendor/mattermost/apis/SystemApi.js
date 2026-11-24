import * as runtime from '../runtime.js';
import { SystemStatusResponseFromJSON, } from '../models/SystemStatusResponse.js';
export class SystemApi extends runtime.BaseAPI {
    async getClientConfigRequestOpts(requestParameters) {
        if (requestParameters['format'] == null) {
            throw new runtime.RequiredError('format', 'Required parameter "format" was null or undefined when calling getClientConfig().');
        }
        const queryParameters = {};
        if (requestParameters['format'] != null) {
            queryParameters['format'] = requestParameters['format'];
        }
        const headerParameters = {};
        if (this.configuration && this.configuration.accessToken) {
            const token = this.configuration.accessToken;
            const tokenString = await token("bearerAuth", []);
            if (tokenString) {
                headerParameters["Authorization"] = `Bearer ${tokenString}`;
            }
        }
        let urlPath = `/api/v4/config/client`;
        return {
            path: urlPath,
            method: 'GET',
            headers: headerParameters,
            query: queryParameters,
        };
    }
    async getClientConfigRaw(requestParameters, initOverrides) {
        const requestOptions = await this.getClientConfigRequestOpts(requestParameters);
        const response = await this.request(requestOptions, initOverrides);
        return new runtime.VoidApiResponse(response);
    }
    async getClientConfig(requestParameters, initOverrides) {
        await this.getClientConfigRaw(requestParameters, initOverrides);
    }
    async getClientLicenseRequestOpts(requestParameters) {
        if (requestParameters['format'] == null) {
            throw new runtime.RequiredError('format', 'Required parameter "format" was null or undefined when calling getClientLicense().');
        }
        const queryParameters = {};
        if (requestParameters['format'] != null) {
            queryParameters['format'] = requestParameters['format'];
        }
        const headerParameters = {};
        if (this.configuration && this.configuration.accessToken) {
            const token = this.configuration.accessToken;
            const tokenString = await token("bearerAuth", []);
            if (tokenString) {
                headerParameters["Authorization"] = `Bearer ${tokenString}`;
            }
        }
        let urlPath = `/api/v4/license/client`;
        return {
            path: urlPath,
            method: 'GET',
            headers: headerParameters,
            query: queryParameters,
        };
    }
    async getClientLicenseRaw(requestParameters, initOverrides) {
        const requestOptions = await this.getClientLicenseRequestOpts(requestParameters);
        const response = await this.request(requestOptions, initOverrides);
        return new runtime.VoidApiResponse(response);
    }
    async getClientLicense(requestParameters, initOverrides) {
        await this.getClientLicenseRaw(requestParameters, initOverrides);
    }
    async getPingRequestOpts(requestParameters) {
        const queryParameters = {};
        if (requestParameters['getServerStatus'] != null) {
            queryParameters['get_server_status'] = requestParameters['getServerStatus'];
        }
        if (requestParameters['deviceId'] != null) {
            queryParameters['device_id'] = requestParameters['deviceId'];
        }
        if (requestParameters['useRestSemantics'] != null) {
            queryParameters['use_rest_semantics'] = requestParameters['useRestSemantics'];
        }
        const headerParameters = {};
        if (this.configuration && this.configuration.accessToken) {
            const token = this.configuration.accessToken;
            const tokenString = await token("bearerAuth", []);
            if (tokenString) {
                headerParameters["Authorization"] = `Bearer ${tokenString}`;
            }
        }
        let urlPath = `/api/v4/system/ping`;
        return {
            path: urlPath,
            method: 'GET',
            headers: headerParameters,
            query: queryParameters,
        };
    }
    async getPingRaw(requestParameters, initOverrides) {
        const requestOptions = await this.getPingRequestOpts(requestParameters);
        const response = await this.request(requestOptions, initOverrides);
        return new runtime.JSONApiResponse(response, (jsonValue) => SystemStatusResponseFromJSON(jsonValue));
    }
    async getPing(requestParameters = {}, initOverrides) {
        const response = await this.getPingRaw(requestParameters, initOverrides);
        return await response.value();
    }
}
