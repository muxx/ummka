export interface Role {
    id?: string;
    name?: string;
    displayName?: string;
    description?: string;
    permissions?: Array<string>;
    schemeManaged?: boolean;
}
export declare function instanceOfRole(value: object): value is Role;
export declare function RoleFromJSON(json: any): Role;
export declare function RoleFromJSONTyped(json: any, ignoreDiscriminator: boolean): Role;
export declare function RoleToJSON(json: any): Role;
export declare function RoleToJSONTyped(value?: Role | null, ignoreDiscriminator?: boolean): any;
