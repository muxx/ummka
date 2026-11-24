export const SidebarCategoryWithChannelsTypeEnum = {
    Channels: 'channels',
    Custom: 'custom',
    DirectMessages: 'direct_messages',
    Favorites: 'favorites',
    Managed: 'managed',
};
export function instanceOfSidebarCategoryWithChannels(value) {
    return true;
}
export function SidebarCategoryWithChannelsFromJSON(json) {
    return SidebarCategoryWithChannelsFromJSONTyped(json, false);
}
export function SidebarCategoryWithChannelsFromJSONTyped(json, ignoreDiscriminator) {
    if (json == null) {
        return json;
    }
    return {
        'id': json['id'] == null ? undefined : json['id'],
        'userId': json['user_id'] == null ? undefined : json['user_id'],
        'teamId': json['team_id'] == null ? undefined : json['team_id'],
        'displayName': json['display_name'] == null ? undefined : json['display_name'],
        'type': json['type'] == null ? undefined : json['type'],
        'channelIds': json['channel_ids'] == null ? undefined : json['channel_ids'],
        'sortOrder': json['sort_order'] == null ? undefined : json['sort_order'],
        'sorting': json['sorting'] == null ? undefined : json['sorting'],
        'muted': json['muted'] == null ? undefined : json['muted'],
        'collapsed': json['collapsed'] == null ? undefined : json['collapsed'],
    };
}
export function SidebarCategoryWithChannelsToJSON(json) {
    return SidebarCategoryWithChannelsToJSONTyped(json, false);
}
export function SidebarCategoryWithChannelsToJSONTyped(value, ignoreDiscriminator = false) {
    if (value == null) {
        return value;
    }
    return {
        'id': value['id'],
        'user_id': value['userId'],
        'team_id': value['teamId'],
        'display_name': value['displayName'],
        'type': value['type'],
        'channel_ids': value['channelIds'],
        'sort_order': value['sortOrder'],
        'sorting': value['sorting'],
        'muted': value['muted'],
        'collapsed': value['collapsed'],
    };
}
