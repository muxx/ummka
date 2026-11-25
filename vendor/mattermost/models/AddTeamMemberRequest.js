export function instanceOfAddTeamMemberRequest(value) {
    if ((!('teamId' in value) && !('team_id' in value)) || (value['teamId'] === undefined && value['team_id'] === undefined))
        return false;
    if ((!('userId' in value) && !('user_id' in value)) || (value['userId'] === undefined && value['user_id'] === undefined))
        return false;
    return true;
}
export function AddTeamMemberRequestFromJSON(json) {
    return AddTeamMemberRequestFromJSONTyped(json, false);
}
export function AddTeamMemberRequestFromJSONTyped(json, ignoreDiscriminator) {
    if (json == null) {
        return json;
    }
    return {
        'teamId': json['team_id'],
        'userId': json['user_id'],
    };
}
export function AddTeamMemberRequestToJSON(json) {
    return AddTeamMemberRequestToJSONTyped(json, false);
}
export function AddTeamMemberRequestToJSONTyped(value, ignoreDiscriminator = false) {
    if (value == null) {
        return value;
    }
    return {
        'team_id': value['teamId'],
        'user_id': value['userId'],
    };
}
