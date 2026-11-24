export function instanceOfTeamMember(value) {
    return true;
}
export function TeamMemberFromJSON(json) {
    return TeamMemberFromJSONTyped(json, false);
}
export function TeamMemberFromJSONTyped(json, ignoreDiscriminator) {
    if (json == null) {
        return json;
    }
    return {
        'teamId': json['team_id'] == null ? undefined : json['team_id'],
        'userId': json['user_id'] == null ? undefined : json['user_id'],
        'roles': json['roles'] == null ? undefined : json['roles'],
        'deleteAt': json['delete_at'] == null ? undefined : json['delete_at'],
        'schemeUser': json['scheme_user'] == null ? undefined : json['scheme_user'],
        'schemeAdmin': json['scheme_admin'] == null ? undefined : json['scheme_admin'],
        'explicitRoles': json['explicit_roles'] == null ? undefined : json['explicit_roles'],
        'schemeGuest': json['scheme_guest'] == null ? undefined : json['scheme_guest'],
    };
}
export function TeamMemberToJSON(json) {
    return TeamMemberToJSONTyped(json, false);
}
export function TeamMemberToJSONTyped(value, ignoreDiscriminator = false) {
    if (value == null) {
        return value;
    }
    return {
        'team_id': value['teamId'],
        'user_id': value['userId'],
        'roles': value['roles'],
        'delete_at': value['deleteAt'],
        'scheme_user': value['schemeUser'],
        'scheme_admin': value['schemeAdmin'],
        'explicit_roles': value['explicitRoles'],
        'scheme_guest': value['schemeGuest'],
    };
}
