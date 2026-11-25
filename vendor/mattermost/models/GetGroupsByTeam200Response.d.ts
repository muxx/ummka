import type { GroupWithSchemeAdmin } from './GroupWithSchemeAdmin.js';
export interface GetGroupsByTeam200Response {
    groups: Array<GroupWithSchemeAdmin>;
    totalGroupCount: number;
}
export declare function instanceOfGetGroupsByTeam200Response(value: object): value is GetGroupsByTeam200Response;
export declare function GetGroupsByTeam200ResponseFromJSON(json: any): GetGroupsByTeam200Response;
export declare function GetGroupsByTeam200ResponseFromJSONTyped(json: any, ignoreDiscriminator: boolean): GetGroupsByTeam200Response;
export declare function GetGroupsByTeam200ResponseToJSON(json: any): GetGroupsByTeam200Response;
export declare function GetGroupsByTeam200ResponseToJSONTyped(value?: GetGroupsByTeam200Response | null, ignoreDiscriminator?: boolean): any;
