export interface Group {
    id?: string;
    name?: string;
    displayName?: string;
    description?: string;
    source?: string;
    remoteId: string | null;
    createAt?: number;
    updateAt?: number;
    deleteAt?: number;
    hasSyncables?: boolean;
    allowReference: boolean;
    memberCount?: number;
}
export declare function instanceOfGroup(value: object): value is Group;
export declare function GroupFromJSON(json: any): Group;
export declare function GroupFromJSONTyped(json: any, ignoreDiscriminator: boolean): Group;
export declare function GroupToJSON(json: any): Group;
export declare function GroupToJSONTyped(value?: Group | null, ignoreDiscriminator?: boolean): any;
