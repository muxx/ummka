export interface SystemStatusResponse {
    androidLatestVersion?: string;
    androidMinVersion?: string;
    desktopLatestVersion?: string;
    desktopMinVersion?: string;
    iosLatestVersion?: string;
    iosMinVersion?: string;
    databaseStatus?: string;
    filestoreStatus?: string;
    status?: string;
    canReceiveNotifications?: string;
}
export declare function instanceOfSystemStatusResponse(value: object): value is SystemStatusResponse;
export declare function SystemStatusResponseFromJSON(json: any): SystemStatusResponse;
export declare function SystemStatusResponseFromJSONTyped(json: any, ignoreDiscriminator: boolean): SystemStatusResponse;
export declare function SystemStatusResponseToJSON(json: any): SystemStatusResponse;
export declare function SystemStatusResponseToJSONTyped(value?: SystemStatusResponse | null, ignoreDiscriminator?: boolean): any;
