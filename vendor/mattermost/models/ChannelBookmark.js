export const ChannelBookmarkTypeEnum = {
    Link: 'link',
    File: 'file',
    Board: 'board',
};
export function instanceOfChannelBookmark(value) {
    return true;
}
export function ChannelBookmarkFromJSON(json) {
    return ChannelBookmarkFromJSONTyped(json, false);
}
export function ChannelBookmarkFromJSONTyped(json, ignoreDiscriminator) {
    if (json == null) {
        return json;
    }
    return {
        'id': json['id'] == null ? undefined : json['id'],
        'createAt': json['create_at'] == null ? undefined : json['create_at'],
        'updateAt': json['update_at'] == null ? undefined : json['update_at'],
        'deleteAt': json['delete_at'] == null ? undefined : json['delete_at'],
        'channelId': json['channel_id'] == null ? undefined : json['channel_id'],
        'ownerId': json['owner_id'] == null ? undefined : json['owner_id'],
        'fileId': json['file_id'] == null ? undefined : json['file_id'],
        'displayName': json['display_name'] == null ? undefined : json['display_name'],
        'sortOrder': json['sort_order'] == null ? undefined : json['sort_order'],
        'linkUrl': json['link_url'] == null ? undefined : json['link_url'],
        'imageUrl': json['image_url'] == null ? undefined : json['image_url'],
        'emoji': json['emoji'] == null ? undefined : json['emoji'],
        'type': json['type'] == null ? undefined : json['type'],
        'targetId': json['target_id'] == null ? undefined : json['target_id'],
        'originalId': json['original_id'] == null ? undefined : json['original_id'],
        'parentId': json['parent_id'] == null ? undefined : json['parent_id'],
    };
}
export function ChannelBookmarkToJSON(json) {
    return ChannelBookmarkToJSONTyped(json, false);
}
export function ChannelBookmarkToJSONTyped(value, ignoreDiscriminator = false) {
    if (value == null) {
        return value;
    }
    return {
        'id': value['id'],
        'create_at': value['createAt'],
        'update_at': value['updateAt'],
        'delete_at': value['deleteAt'],
        'channel_id': value['channelId'],
        'owner_id': value['ownerId'],
        'file_id': value['fileId'],
        'display_name': value['displayName'],
        'sort_order': value['sortOrder'],
        'link_url': value['linkUrl'],
        'image_url': value['imageUrl'],
        'emoji': value['emoji'],
        'type': value['type'],
        'target_id': value['targetId'],
        'original_id': value['originalId'],
        'parent_id': value['parentId'],
    };
}
