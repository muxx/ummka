export interface MarkChannelsReadForUser200Response {
    status?: string;
    lastViewedAtTimes?: {
        [key: string]: number;
    };
}
export declare function instanceOfMarkChannelsReadForUser200Response(value: object): value is MarkChannelsReadForUser200Response;
export declare function MarkChannelsReadForUser200ResponseFromJSON(json: any): MarkChannelsReadForUser200Response;
export declare function MarkChannelsReadForUser200ResponseFromJSONTyped(json: any, ignoreDiscriminator: boolean): MarkChannelsReadForUser200Response;
export declare function MarkChannelsReadForUser200ResponseToJSON(json: any): MarkChannelsReadForUser200Response;
export declare function MarkChannelsReadForUser200ResponseToJSONTyped(value?: MarkChannelsReadForUser200Response | null, ignoreDiscriminator?: boolean): any;
