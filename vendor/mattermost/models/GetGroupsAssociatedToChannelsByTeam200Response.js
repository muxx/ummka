import { mapValues } from '../runtime.js';
import { GroupWithSchemeAdminFromJSON, GroupWithSchemeAdminToJSON, } from './GroupWithSchemeAdmin.js';
export function instanceOfGetGroupsAssociatedToChannelsByTeam200Response(value) {
    if (!('groups' in value) || value['groups'] === undefined)
        return false;
    return true;
}
export function GetGroupsAssociatedToChannelsByTeam200ResponseFromJSON(json) {
    return GetGroupsAssociatedToChannelsByTeam200ResponseFromJSONTyped(json, false);
}
export function GetGroupsAssociatedToChannelsByTeam200ResponseFromJSONTyped(json, ignoreDiscriminator) {
    if (json == null) {
        return json;
    }
    return {
        'groups': json['groups'] == null ? json['groups'] : mapValues(json['groups'], rows => rows == null ? rows : rows.map(GroupWithSchemeAdminFromJSON)),
    };
}
export function GetGroupsAssociatedToChannelsByTeam200ResponseToJSON(json) {
    return GetGroupsAssociatedToChannelsByTeam200ResponseToJSONTyped(json, false);
}
export function GetGroupsAssociatedToChannelsByTeam200ResponseToJSONTyped(value, ignoreDiscriminator = false) {
    if (value == null) {
        return value;
    }
    return {
        'groups': value['groups'] == null ? value['groups'] : mapValues(value['groups'], rows => rows == null ? rows : Array.from(rows, GroupWithSchemeAdminToJSON)),
    };
}
