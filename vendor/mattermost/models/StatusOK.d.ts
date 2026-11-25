export interface StatusOK {
    status?: string;
}
export declare function instanceOfStatusOK(value: object): value is StatusOK;
export declare function StatusOKFromJSON(json: any): StatusOK;
export declare function StatusOKFromJSONTyped(json: any, ignoreDiscriminator: boolean): StatusOK;
export declare function StatusOKToJSON(json: any): StatusOK;
export declare function StatusOKToJSONTyped(value?: StatusOK | null, ignoreDiscriminator?: boolean): any;
