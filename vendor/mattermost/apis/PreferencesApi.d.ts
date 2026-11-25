import * as runtime from '../runtime.js';
import { type Preference } from '../models/Preference.js';
import { type StatusOK } from '../models/StatusOK.js';
export interface DeletePreferencesRequest {
    userId: string;
    preference: Array<Preference>;
}
export interface GetPreferencesRequest {
    userId: string;
}
export interface UpdatePreferencesRequest {
    userId: string;
    preference: Array<Preference>;
}
export declare class PreferencesApi extends runtime.BaseAPI {
    deletePreferencesRequestOpts(requestParameters: DeletePreferencesRequest): Promise<runtime.RequestOpts>;
    deletePreferencesRaw(requestParameters: DeletePreferencesRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<runtime.ApiResponse<StatusOK>>;
    deletePreferences(requestParameters: DeletePreferencesRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<StatusOK>;
    getPreferencesRequestOpts(requestParameters: GetPreferencesRequest): Promise<runtime.RequestOpts>;
    getPreferencesRaw(requestParameters: GetPreferencesRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<runtime.ApiResponse<Array<Preference> | null>>;
    getPreferences(requestParameters: GetPreferencesRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<Array<Preference> | null>;
    updatePreferencesRequestOpts(requestParameters: UpdatePreferencesRequest): Promise<runtime.RequestOpts>;
    updatePreferencesRaw(requestParameters: UpdatePreferencesRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<runtime.ApiResponse<StatusOK>>;
    updatePreferences(requestParameters: UpdatePreferencesRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<StatusOK>;
}
