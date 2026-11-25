export interface CommandResponse {
    responseType: string;
    text: string;
    username: string;
    channelId: string;
    iconUrl: string;
    type: string;
    props: {
        [key: string]: any;
    } | null;
    gotoLocation: string;
    triggerId: string;
    skipSlackParsing: boolean;
    attachments: Array<{
        [key: string]: any;
    } | null> | null;
    extraResponses: Array<CommandResponse | null> | null;
}
export declare function instanceOfCommandResponse(value: object): value is CommandResponse;
export declare function CommandResponseFromJSON(json: any): CommandResponse;
export declare function CommandResponseFromJSONTyped(json: any, ignoreDiscriminator: boolean): CommandResponse;
export declare function CommandResponseToJSON(json: any): CommandResponse;
export declare function CommandResponseToJSONTyped(value?: CommandResponse | null, ignoreDiscriminator?: boolean): any;
