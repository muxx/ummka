export interface Channel {
    id?: string;
    createAt?: number;
    updateAt?: number;
    deleteAt?: number;
    teamId?: string;
    type?: string;
    displayName?: string;
    name?: string;
    header?: string;
    purpose?: string;
    lastPostAt?: number;
    totalMsgCount?: number;
    extraUpdateAt?: number;
    creatorId?: string;
    totalMsgCountRoot?: number;
    lastRootPostAt?: number;
    shared?: boolean | null;
    groupConstrained?: boolean | null;
}
export declare function instanceOfChannel(value: object): value is Channel;
export declare function ChannelFromJSON(json: any): Channel;
export declare function ChannelFromJSONTyped(json: any, ignoreDiscriminator: boolean): Channel;
export declare function ChannelToJSON(json: any): Channel;
export declare function ChannelToJSONTyped(value?: Channel | null, ignoreDiscriminator?: boolean): any;
