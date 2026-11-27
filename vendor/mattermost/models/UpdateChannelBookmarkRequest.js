export function instanceOfUpdateChannelBookmarkRequest(value) {
    return true;
}
export function UpdateChannelBookmarkRequestFromJSON(json) {
    return UpdateChannelBookmarkRequestFromJSONTyped(json, false);
}
export function UpdateChannelBookmarkRequestFromJSONTyped(json, ignoreDiscriminator) {
    if (json == null) {
        return json;
    }
    return {
        'fileId': json['file_id'] == null ? undefined : json['file_id'],
        'displayName': json['display_name'] == null ? undefined : json['display_name'],
        'sortOrder': json['sort_order'] == null ? undefined : json['sort_order'],
        'linkUrl': json['link_url'] == null ? undefined : json['link_url'],
        'imageUrl': json['image_url'] == null ? undefined : json['image_url'],
        'emoji': json['emoji'] == null ? undefined : json['emoji'],
    };
}
export function UpdateChannelBookmarkRequestToJSON(json) {
    return UpdateChannelBookmarkRequestToJSONTyped(json, false);
}
export function UpdateChannelBookmarkRequestToJSONTyped(value, ignoreDiscriminator = false) {
    if (value == null) {
        return value;
    }
    return {
        'file_id': value['fileId'],
        'display_name': value['displayName'],
        'sort_order': value['sortOrder'],
        'link_url': value['linkUrl'],
        'image_url': value['imageUrl'],
        'emoji': value['emoji'],
    };
}
