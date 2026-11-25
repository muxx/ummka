import type { GroupWithSchemeAdmin } from './GroupWithSchemeAdmin.js';
export interface GetGroupsAssociatedToChannelsByTeam200Response {
    groups: {
        [key: string]: Array<GroupWithSchemeAdmin>;
    };
}
export declare function instanceOfGetGroupsAssociatedToChannelsByTeam200Response(value: object): value is GetGroupsAssociatedToChannelsByTeam200Response;
export declare function GetGroupsAssociatedToChannelsByTeam200ResponseFromJSON(json: any): GetGroupsAssociatedToChannelsByTeam200Response;
export declare function GetGroupsAssociatedToChannelsByTeam200ResponseFromJSONTyped(json: any, ignoreDiscriminator: boolean): GetGroupsAssociatedToChannelsByTeam200Response;
export declare function GetGroupsAssociatedToChannelsByTeam200ResponseToJSON(json: any): GetGroupsAssociatedToChannelsByTeam200Response;
export declare function GetGroupsAssociatedToChannelsByTeam200ResponseToJSONTyped(value?: GetGroupsAssociatedToChannelsByTeam200Response | null, ignoreDiscriminator?: boolean): any;
