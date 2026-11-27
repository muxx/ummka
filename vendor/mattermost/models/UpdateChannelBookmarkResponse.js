import { ChannelBookmarkWithFileInfoFromJSON, ChannelBookmarkWithFileInfoToJSON, } from './ChannelBookmarkWithFileInfo.js';
export function instanceOfUpdateChannelBookmarkResponse(value) {
    return true;
}
export function UpdateChannelBookmarkResponseFromJSON(json) {
    return UpdateChannelBookmarkResponseFromJSONTyped(json, false);
}
export function UpdateChannelBookmarkResponseFromJSONTyped(json, ignoreDiscriminator) {
    if (json == null) {
        return json;
    }
    return {
        'updated': json['updated'] == null ? undefined : ChannelBookmarkWithFileInfoFromJSON(json['updated']),
        'deleted': json['deleted'] == null ? undefined : ChannelBookmarkWithFileInfoFromJSON(json['deleted']),
    };
}
export function UpdateChannelBookmarkResponseToJSON(json) {
    return UpdateChannelBookmarkResponseToJSONTyped(json, false);
}
export function UpdateChannelBookmarkResponseToJSONTyped(value, ignoreDiscriminator = false) {
    if (value == null) {
        return value;
    }
    return {
        'updated': ChannelBookmarkWithFileInfoToJSON(value['updated']),
        'deleted': ChannelBookmarkWithFileInfoToJSON(value['deleted']),
    };
}
