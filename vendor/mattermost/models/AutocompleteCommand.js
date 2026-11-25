export function instanceOfAutocompleteCommand(value) {
    return true;
}
export function AutocompleteCommandFromJSON(json) {
    return AutocompleteCommandFromJSONTyped(json, false);
}
export function AutocompleteCommandFromJSONTyped(json, ignoreDiscriminator) {
    if (json == null) {
        return json;
    }
    return {
        'id': json['id'] == null ? undefined : json['id'],
        'trigger': json['trigger'] == null ? undefined : json['trigger'],
        'displayName': json['display_name'] == null ? undefined : json['display_name'],
        'autoComplete': json['auto_complete'] == null ? undefined : json['auto_complete'],
        'autoCompleteHint': json['auto_complete_hint'] == null ? undefined : json['auto_complete_hint'],
        'autoCompleteDesc': json['auto_complete_desc'] == null ? undefined : json['auto_complete_desc'],
        'iconUrl': json['icon_url'] == null ? undefined : json['icon_url'],
        'autocompleteIconData': json['autocomplete_icon_data'] == null ? undefined : json['autocomplete_icon_data'],
    };
}
export function AutocompleteCommandToJSON(json) {
    return AutocompleteCommandToJSONTyped(json, false);
}
export function AutocompleteCommandToJSONTyped(value, ignoreDiscriminator = false) {
    if (value == null) {
        return value;
    }
    return {
        'id': value['id'],
        'trigger': value['trigger'],
        'display_name': value['displayName'],
        'auto_complete': value['autoComplete'],
        'auto_complete_hint': value['autoCompleteHint'],
        'auto_complete_desc': value['autoCompleteDesc'],
        'icon_url': value['iconUrl'],
        'autocomplete_icon_data': value['autocompleteIconData'],
    };
}
