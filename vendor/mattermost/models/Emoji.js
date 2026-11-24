export function instanceOfEmoji(value) {
    return true;
}
export function EmojiFromJSON(json) {
    return EmojiFromJSONTyped(json, false);
}
export function EmojiFromJSONTyped(json, ignoreDiscriminator) {
    if (json == null) {
        return json;
    }
    return {
        'id': json['id'] == null ? undefined : json['id'],
        'creatorId': json['creator_id'] == null ? undefined : json['creator_id'],
        'name': json['name'] == null ? undefined : json['name'],
        'createAt': json['create_at'] == null ? undefined : json['create_at'],
        'updateAt': json['update_at'] == null ? undefined : json['update_at'],
        'deleteAt': json['delete_at'] == null ? undefined : json['delete_at'],
    };
}
export function EmojiToJSON(json) {
    return EmojiToJSONTyped(json, false);
}
export function EmojiToJSONTyped(value, ignoreDiscriminator = false) {
    if (value == null) {
        return value;
    }
    return {
        'id': value['id'],
        'creator_id': value['creatorId'],
        'name': value['name'],
        'create_at': value['createAt'],
        'update_at': value['updateAt'],
        'delete_at': value['deleteAt'],
    };
}
