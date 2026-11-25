import { GroupWithSchemeAdminFromJSON, GroupWithSchemeAdminToJSON, } from './GroupWithSchemeAdmin.js';
export function instanceOfGetGroupsByTeam200Response(value) {
    if (!('groups' in value) || value['groups'] === undefined)
        return false;
    if ((!('totalGroupCount' in value) && !('total_group_count' in value)) || (value['totalGroupCount'] === undefined && value['total_group_count'] === undefined))
        return false;
    return true;
}
export function GetGroupsByTeam200ResponseFromJSON(json) {
    return GetGroupsByTeam200ResponseFromJSONTyped(json, false);
}
export function GetGroupsByTeam200ResponseFromJSONTyped(json, ignoreDiscriminator) {
    if (json == null) {
        return json;
    }
    return {
        'groups': (json['groups'].map(GroupWithSchemeAdminFromJSON)),
        'totalGroupCount': json['total_group_count'],
    };
}
export function GetGroupsByTeam200ResponseToJSON(json) {
    return GetGroupsByTeam200ResponseToJSONTyped(json, false);
}
export function GetGroupsByTeam200ResponseToJSONTyped(value, ignoreDiscriminator = false) {
    if (value == null) {
        return value;
    }
    return {
        'groups': (value['groups'].map(GroupWithSchemeAdminToJSON)),
        'total_group_count': value['totalGroupCount'],
    };
}
