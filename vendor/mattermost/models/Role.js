export function instanceOfRole(value) {
    return true;
}
export function RoleFromJSON(json) {
    return RoleFromJSONTyped(json, false);
}
export function RoleFromJSONTyped(json, ignoreDiscriminator) {
    if (json == null) {
        return json;
    }
    return {
        'id': json['id'] == null ? undefined : json['id'],
        'name': json['name'] == null ? undefined : json['name'],
        'displayName': json['display_name'] == null ? undefined : json['display_name'],
        'description': json['description'] == null ? undefined : json['description'],
        'permissions': json['permissions'] == null ? undefined : json['permissions'],
        'schemeManaged': json['scheme_managed'] == null ? undefined : json['scheme_managed'],
    };
}
export function RoleToJSON(json) {
    return RoleToJSONTyped(json, false);
}
export function RoleToJSONTyped(value, ignoreDiscriminator = false) {
    if (value == null) {
        return value;
    }
    return {
        'id': value['id'],
        'name': value['name'],
        'display_name': value['displayName'],
        'description': value['description'],
        'permissions': value['permissions'],
        'scheme_managed': value['schemeManaged'],
    };
}
