export function instanceOfCommandResponse(value) {
    if ((!('responseType' in value) && !('response_type' in value)) || (value['responseType'] === undefined && value['response_type'] === undefined))
        return false;
    if (!('text' in value) || value['text'] === undefined)
        return false;
    if (!('username' in value) || value['username'] === undefined)
        return false;
    if ((!('channelId' in value) && !('channel_id' in value)) || (value['channelId'] === undefined && value['channel_id'] === undefined))
        return false;
    if ((!('iconUrl' in value) && !('icon_url' in value)) || (value['iconUrl'] === undefined && value['icon_url'] === undefined))
        return false;
    if (!('type' in value) || value['type'] === undefined)
        return false;
    if (!('props' in value) || value['props'] === undefined)
        return false;
    if ((!('gotoLocation' in value) && !('goto_location' in value)) || (value['gotoLocation'] === undefined && value['goto_location'] === undefined))
        return false;
    if ((!('triggerId' in value) && !('trigger_id' in value)) || (value['triggerId'] === undefined && value['trigger_id'] === undefined))
        return false;
    if ((!('skipSlackParsing' in value) && !('skip_slack_parsing' in value)) || (value['skipSlackParsing'] === undefined && value['skip_slack_parsing'] === undefined))
        return false;
    if (!('attachments' in value) || value['attachments'] === undefined)
        return false;
    if ((!('extraResponses' in value) && !('extra_responses' in value)) || (value['extraResponses'] === undefined && value['extra_responses'] === undefined))
        return false;
    return true;
}
export function CommandResponseFromJSON(json) {
    return CommandResponseFromJSONTyped(json, false);
}
export function CommandResponseFromJSONTyped(json, ignoreDiscriminator) {
    if (json == null) {
        return json;
    }
    return {
        'responseType': json['response_type'],
        'text': json['text'],
        'username': json['username'],
        'channelId': json['channel_id'],
        'iconUrl': json['icon_url'],
        'type': json['type'],
        'props': json['props'],
        'gotoLocation': json['goto_location'],
        'triggerId': json['trigger_id'],
        'skipSlackParsing': json['skip_slack_parsing'],
        'attachments': json['attachments'] == null ? null : json['attachments'],
        'extraResponses': (json['extra_responses'] == null ? null : json['extra_responses'].map(CommandResponseFromJSON)),
    };
}
export function CommandResponseToJSON(json) {
    return CommandResponseToJSONTyped(json, false);
}
export function CommandResponseToJSONTyped(value, ignoreDiscriminator = false) {
    if (value == null) {
        return value;
    }
    return {
        'response_type': value['responseType'],
        'text': value['text'],
        'username': value['username'],
        'channel_id': value['channelId'],
        'icon_url': value['iconUrl'],
        'type': value['type'],
        'props': value['props'],
        'goto_location': value['gotoLocation'],
        'trigger_id': value['triggerId'],
        'skip_slack_parsing': value['skipSlackParsing'],
        'attachments': value['attachments'],
        'extra_responses': (value['extraResponses'] == null ? null : value['extraResponses'].map(CommandResponseToJSON)),
    };
}
