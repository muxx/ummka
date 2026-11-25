export function instanceOfEmoji(value) {
    if (!('id' in value) || value['id'] === undefined)
        return false;
    if ((!('creatorId' in value) && !('creator_id' in value)) || (value['creatorId'] === undefined && value['creator_id'] === undefined))
        return false;
    if (!('name' in value) || value['name'] === undefined)
        return false;
    if ((!('createAt' in value) && !('create_at' in value)) || (value['createAt'] === undefined && value['create_at'] === undefined))
        return false;
    if ((!('updateAt' in value) && !('update_at' in value)) || (value['updateAt'] === undefined && value['update_at'] === undefined))
        return false;
    if ((!('deleteAt' in value) && !('delete_at' in value)) || (value['deleteAt'] === undefined && value['delete_at'] === undefined))
        return false;
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
        'id': json['id'],
        'creatorId': json['creator_id'],
        'name': json['name'],
        'createAt': json['create_at'],
        'updateAt': json['update_at'],
        'deleteAt': json['delete_at'],
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
