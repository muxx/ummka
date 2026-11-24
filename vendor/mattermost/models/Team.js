export function instanceOfTeam(value) {
    return true;
}
export function TeamFromJSON(json) {
    return TeamFromJSONTyped(json, false);
}
export function TeamFromJSONTyped(json, ignoreDiscriminator) {
    if (json == null) {
        return json;
    }
    return {
        'id': json['id'] == null ? undefined : json['id'],
        'createAt': json['create_at'] == null ? undefined : json['create_at'],
        'updateAt': json['update_at'] == null ? undefined : json['update_at'],
        'deleteAt': json['delete_at'] == null ? undefined : json['delete_at'],
        'displayName': json['display_name'] == null ? undefined : json['display_name'],
        'name': json['name'] == null ? undefined : json['name'],
        'description': json['description'] == null ? undefined : json['description'],
        'email': json['email'] == null ? undefined : json['email'],
        'type': json['type'] == null ? undefined : json['type'],
        'allowedDomains': json['allowed_domains'] == null ? undefined : json['allowed_domains'],
        'inviteId': json['invite_id'] == null ? undefined : json['invite_id'],
        'allowOpenInvite': json['allow_open_invite'] == null ? undefined : json['allow_open_invite'],
        'policyId': json['policy_id'] == null ? undefined : json['policy_id'],
    };
}
export function TeamToJSON(json) {
    return TeamToJSONTyped(json, false);
}
export function TeamToJSONTyped(value, ignoreDiscriminator = false) {
    if (value == null) {
        return value;
    }
    return {
        'id': value['id'],
        'create_at': value['createAt'],
        'update_at': value['updateAt'],
        'delete_at': value['deleteAt'],
        'display_name': value['displayName'],
        'name': value['name'],
        'description': value['description'],
        'email': value['email'],
        'type': value['type'],
        'allowed_domains': value['allowedDomains'],
        'invite_id': value['inviteId'],
        'allow_open_invite': value['allowOpenInvite'],
        'policy_id': value['policyId'],
    };
}
