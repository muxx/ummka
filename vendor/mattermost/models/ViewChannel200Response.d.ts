export interface ViewChannel200Response {
    status?: string;
    lastViewedAtTimes?: {
        [key: string]: number;
    };
}
export declare function instanceOfViewChannel200Response(value: object): value is ViewChannel200Response;
export declare function ViewChannel200ResponseFromJSON(json: any): ViewChannel200Response;
export declare function ViewChannel200ResponseFromJSONTyped(json: any, ignoreDiscriminator: boolean): ViewChannel200Response;
export declare function ViewChannel200ResponseToJSON(json: any): ViewChannel200Response;
export declare function ViewChannel200ResponseToJSONTyped(value?: ViewChannel200Response | null, ignoreDiscriminator?: boolean): any;
