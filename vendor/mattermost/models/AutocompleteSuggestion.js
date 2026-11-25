export function instanceOfAutocompleteSuggestion(value) {
    return true;
}
export function AutocompleteSuggestionFromJSON(json) {
    return AutocompleteSuggestionFromJSONTyped(json, false);
}
export function AutocompleteSuggestionFromJSONTyped(json, ignoreDiscriminator) {
    if (json == null) {
        return json;
    }
    return {
        'complete': json['Complete'] == null ? undefined : json['Complete'],
        'suggestion': json['Suggestion'] == null ? undefined : json['Suggestion'],
        'hint': json['Hint'] == null ? undefined : json['Hint'],
        'description': json['Description'] == null ? undefined : json['Description'],
        'iconData': json['IconData'] == null ? undefined : json['IconData'],
    };
}
export function AutocompleteSuggestionToJSON(json) {
    return AutocompleteSuggestionToJSONTyped(json, false);
}
export function AutocompleteSuggestionToJSONTyped(value, ignoreDiscriminator = false) {
    if (value == null) {
        return value;
    }
    return {
        'Complete': value['complete'],
        'Suggestion': value['suggestion'],
        'Hint': value['hint'],
        'Description': value['description'],
        'IconData': value['iconData'],
    };
}
