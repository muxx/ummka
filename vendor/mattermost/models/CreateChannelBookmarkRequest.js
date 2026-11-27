export const CreateChannelBookmarkRequestTypeEnum = {
    Link: 'link',
    File: 'file',
};
export function instanceOfCreateChannelBookmarkRequest(value) {
    if ((!('displayName' in value) && !('display_name' in value)) || (value['displayName'] === undefined && value['display_name'] === undefined))
        return false;
    if (!('type' in value) || value['type'] === undefined)
        return false;
    return true;
}
export function CreateChannelBookmarkRequestFromJSON(json) {
    return CreateChannelBookmarkRequestFromJSONTyped(json, false);
}
export function CreateChannelBookmarkRequestFromJSONTyped(json, ignoreDiscriminator) {
    if (json == null) {
        return json;
    }
    return {
        'fileId': json['file_id'] == null ? undefined : json['file_id'],
        'displayName': json['display_name'],
        'linkUrl': json['link_url'] == null ? undefined : json['link_url'],
        'imageUrl': json['image_url'] == null ? undefined : json['image_url'],
        'emoji': json['emoji'] == null ? undefined : json['emoji'],
        'type': json['type'],
    };
}
export function CreateChannelBookmarkRequestToJSON(json) {
    return CreateChannelBookmarkRequestToJSONTyped(json, false);
}
export function CreateChannelBookmarkRequestToJSONTyped(value, ignoreDiscriminator = false) {
    if (value == null) {
        return value;
    }
    return {
        'file_id': value['fileId'],
        'display_name': value['displayName'],
        'link_url': value['linkUrl'],
        'image_url': value['imageUrl'],
        'emoji': value['emoji'],
        'type': value['type'],
    };
}
