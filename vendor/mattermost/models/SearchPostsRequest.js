export function instanceOfSearchPostsRequest(value) {
    if (!('terms' in value) || value['terms'] === undefined)
        return false;
    if ((!('isOrSearch' in value) && !('is_or_search' in value)) || (value['isOrSearch'] === undefined && value['is_or_search'] === undefined))
        return false;
    return true;
}
export function SearchPostsRequestFromJSON(json) {
    return SearchPostsRequestFromJSONTyped(json, false);
}
export function SearchPostsRequestFromJSONTyped(json, ignoreDiscriminator) {
    if (json == null) {
        return json;
    }
    return {
        'terms': json['terms'],
        'isOrSearch': json['is_or_search'],
        'timeZoneOffset': json['time_zone_offset'] == null ? undefined : json['time_zone_offset'],
        'includeDeletedChannels': json['include_deleted_channels'] == null ? undefined : json['include_deleted_channels'],
        'page': json['page'] == null ? undefined : json['page'],
        'perPage': json['per_page'] == null ? undefined : json['per_page'],
    };
}
export function SearchPostsRequestToJSON(json) {
    return SearchPostsRequestToJSONTyped(json, false);
}
export function SearchPostsRequestToJSONTyped(value, ignoreDiscriminator = false) {
    if (value == null) {
        return value;
    }
    return {
        'terms': value['terms'],
        'is_or_search': value['isOrSearch'],
        'time_zone_offset': value['timeZoneOffset'],
        'include_deleted_channels': value['includeDeletedChannels'],
        'page': value['page'],
        'per_page': value['perPage'],
    };
}
