export interface AppError {
    statusCode?: number;
    id?: string;
    message?: string;
    requestId?: string;
}
export declare function instanceOfAppError(value: object): value is AppError;
export declare function AppErrorFromJSON(json: any): AppError;
export declare function AppErrorFromJSONTyped(json: any, ignoreDiscriminator: boolean): AppError;
export declare function AppErrorToJSON(json: any): AppError;
export declare function AppErrorToJSONTyped(value?: AppError | null, ignoreDiscriminator?: boolean): any;
