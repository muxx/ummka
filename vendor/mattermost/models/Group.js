export function instanceOfGroup(value) {
    if ((!('remoteId' in value) && !('remote_id' in value)) || (value['remoteId'] === undefined && value['remote_id'] === undefined))
        return false;
    if ((!('allowReference' in value) && !('allow_reference' in value)) || (value['allowReference'] === undefined && value['allow_reference'] === undefined))
        return false;
    return true;
}
export function GroupFromJSON(json) {
    return GroupFromJSONTyped(json, false);
}
export function GroupFromJSONTyped(json, ignoreDiscriminator) {
    if (json == null) {
        return json;
    }
    return {
        'id': json['id'] == null ? undefined : json['id'],
        'name': json['name'] == null ? undefined : json['name'],
        'displayName': json['display_name'] == null ? undefined : json['display_name'],
        'description': json['description'] == null ? undefined : json['description'],
        'source': json['source'] == null ? undefined : json['source'],
        'remoteId': json['remote_id'],
        'createAt': json['create_at'] == null ? undefined : json['create_at'],
        'updateAt': json['update_at'] == null ? undefined : json['update_at'],
        'deleteAt': json['delete_at'] == null ? undefined : json['delete_at'],
        'hasSyncables': json['has_syncables'] == null ? undefined : json['has_syncables'],
        'allowReference': json['allow_reference'],
        'memberCount': json['member_count'] == null ? undefined : json['member_count'],
    };
}
export function GroupToJSON(json) {
    return GroupToJSONTyped(json, false);
}
export function GroupToJSONTyped(value, ignoreDiscriminator = false) {
    if (value == null) {
        return value;
    }
    return {
        'id': value['id'],
        'name': value['name'],
        'display_name': value['displayName'],
        'description': value['description'],
        'source': value['source'],
        'remote_id': value['remoteId'],
        'create_at': value['createAt'],
        'update_at': value['updateAt'],
        'delete_at': value['deleteAt'],
        'has_syncables': value['hasSyncables'],
        'allow_reference': value['allowReference'],
        'member_count': value['memberCount'],
    };
}
