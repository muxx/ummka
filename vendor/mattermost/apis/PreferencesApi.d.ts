import * as runtime from '../runtime.js';
import { type Preference } from '../models/Preference.js';
export interface GetPreferencesRequest {
    userId: string;
}
export declare class PreferencesApi extends runtime.BaseAPI {
    getPreferencesRequestOpts(requestParameters: GetPreferencesRequest): Promise<runtime.RequestOpts>;
    getPreferencesRaw(requestParameters: GetPreferencesRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<runtime.ApiResponse<Array<Preference> | null>>;
    getPreferences(requestParameters: GetPreferencesRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<Array<Preference> | null>;
}
