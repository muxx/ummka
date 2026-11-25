export interface ExecuteCommandRequest {
    channelId: string;
    command: string;
    teamId?: string;
    rootId?: string;
}
export declare function instanceOfExecuteCommandRequest(value: object): value is ExecuteCommandRequest;
export declare function ExecuteCommandRequestFromJSON(json: any): ExecuteCommandRequest;
export declare function ExecuteCommandRequestFromJSONTyped(json: any, ignoreDiscriminator: boolean): ExecuteCommandRequest;
export declare function ExecuteCommandRequestToJSON(json: any): ExecuteCommandRequest;
export declare function ExecuteCommandRequestToJSONTyped(value?: ExecuteCommandRequest | null, ignoreDiscriminator?: boolean): any;
