export function instanceOfFileInfo(value) {
    return true;
}
export function FileInfoFromJSON(json) {
    return FileInfoFromJSONTyped(json, false);
}
export function FileInfoFromJSONTyped(json, ignoreDiscriminator) {
    if (json == null) {
        return json;
    }
    return {
        'id': json['id'] == null ? undefined : json['id'],
        'userId': json['user_id'] == null ? undefined : json['user_id'],
        'postId': json['post_id'] == null ? undefined : json['post_id'],
        'createAt': json['create_at'] == null ? undefined : json['create_at'],
        'updateAt': json['update_at'] == null ? undefined : json['update_at'],
        'deleteAt': json['delete_at'] == null ? undefined : json['delete_at'],
        'name': json['name'] == null ? undefined : json['name'],
        'extension': json['extension'] == null ? undefined : json['extension'],
        'size': json['size'] == null ? undefined : json['size'],
        'mimeType': json['mime_type'] == null ? undefined : json['mime_type'],
        'width': json['width'] == null ? undefined : json['width'],
        'height': json['height'] == null ? undefined : json['height'],
        'hasPreviewImage': json['has_preview_image'] == null ? undefined : json['has_preview_image'],
        'channelId': json['channel_id'] == null ? undefined : json['channel_id'],
        'archived': json['archived'] == null ? undefined : json['archived'],
    };
}
export function FileInfoToJSON(json) {
    return FileInfoToJSONTyped(json, false);
}
export function FileInfoToJSONTyped(value, ignoreDiscriminator = false) {
    if (value == null) {
        return value;
    }
    return {
        'id': value['id'],
        'user_id': value['userId'],
        'post_id': value['postId'],
        'create_at': value['createAt'],
        'update_at': value['updateAt'],
        'delete_at': value['deleteAt'],
        'name': value['name'],
        'extension': value['extension'],
        'size': value['size'],
        'mime_type': value['mimeType'],
        'width': value['width'],
        'height': value['height'],
        'has_preview_image': value['hasPreviewImage'],
        'channel_id': value['channelId'],
        'archived': value['archived'],
    };
}
