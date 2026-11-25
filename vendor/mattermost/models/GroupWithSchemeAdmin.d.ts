export interface GroupWithSchemeAdmin {
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
    schemeAdmin?: boolean;
}
export declare function instanceOfGroupWithSchemeAdmin(value: object): value is GroupWithSchemeAdmin;
export declare function GroupWithSchemeAdminFromJSON(json: any): GroupWithSchemeAdmin;
export declare function GroupWithSchemeAdminFromJSONTyped(json: any, ignoreDiscriminator: boolean): GroupWithSchemeAdmin;
export declare function GroupWithSchemeAdminToJSON(json: any): GroupWithSchemeAdmin;
export declare function GroupWithSchemeAdminToJSONTyped(value?: GroupWithSchemeAdmin | null, ignoreDiscriminator?: boolean): any;
