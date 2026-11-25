export function instanceOfChannel(value) {
    return true;
}
export function ChannelFromJSON(json) {
    return ChannelFromJSONTyped(json, false);
}
export function ChannelFromJSONTyped(json, ignoreDiscriminator) {
    if (json == null) {
        return json;
    }
    return {
        'id': json['id'] == null ? undefined : json['id'],
        'createAt': json['create_at'] == null ? undefined : json['create_at'],
        'updateAt': json['update_at'] == null ? undefined : json['update_at'],
        'deleteAt': json['delete_at'] == null ? undefined : json['delete_at'],
        'teamId': json['team_id'] == null ? undefined : json['team_id'],
        'type': json['type'] == null ? undefined : json['type'],
        'displayName': json['display_name'] == null ? undefined : json['display_name'],
        'name': json['name'] == null ? undefined : json['name'],
        'header': json['header'] == null ? undefined : json['header'],
        'purpose': json['purpose'] == null ? undefined : json['purpose'],
        'lastPostAt': json['last_post_at'] == null ? undefined : json['last_post_at'],
        'totalMsgCount': json['total_msg_count'] == null ? undefined : json['total_msg_count'],
        'extraUpdateAt': json['extra_update_at'] == null ? undefined : json['extra_update_at'],
        'creatorId': json['creator_id'] == null ? undefined : json['creator_id'],
        'totalMsgCountRoot': json['total_msg_count_root'] == null ? undefined : json['total_msg_count_root'],
        'lastRootPostAt': json['last_root_post_at'] == null ? undefined : json['last_root_post_at'],
        'shared': json['shared'] === undefined ? undefined : json['shared'] === null ? null : json['shared'],
    };
}
export function ChannelToJSON(json) {
    return ChannelToJSONTyped(json, false);
}
export function ChannelToJSONTyped(value, ignoreDiscriminator = false) {
    if (value == null) {
        return value;
    }
    return {
        'id': value['id'],
        'create_at': value['createAt'],
        'update_at': value['updateAt'],
        'delete_at': value['deleteAt'],
        'team_id': value['teamId'],
        'type': value['type'],
        'display_name': value['displayName'],
        'name': value['name'],
        'header': value['header'],
        'purpose': value['purpose'],
        'last_post_at': value['lastPostAt'],
        'total_msg_count': value['totalMsgCount'],
        'extra_update_at': value['extraUpdateAt'],
        'creator_id': value['creatorId'],
        'total_msg_count_root': value['totalMsgCountRoot'],
        'last_root_post_at': value['lastRootPostAt'],
        'shared': value['shared'],
    };
}
