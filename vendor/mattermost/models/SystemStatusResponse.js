export function instanceOfSystemStatusResponse(value) {
    return true;
}
export function SystemStatusResponseFromJSON(json) {
    return SystemStatusResponseFromJSONTyped(json, false);
}
export function SystemStatusResponseFromJSONTyped(json, ignoreDiscriminator) {
    if (json == null) {
        return json;
    }
    return {
        'androidLatestVersion': json['AndroidLatestVersion'] == null ? undefined : json['AndroidLatestVersion'],
        'androidMinVersion': json['AndroidMinVersion'] == null ? undefined : json['AndroidMinVersion'],
        'desktopLatestVersion': json['DesktopLatestVersion'] == null ? undefined : json['DesktopLatestVersion'],
        'desktopMinVersion': json['DesktopMinVersion'] == null ? undefined : json['DesktopMinVersion'],
        'iosLatestVersion': json['IosLatestVersion'] == null ? undefined : json['IosLatestVersion'],
        'iosMinVersion': json['IosMinVersion'] == null ? undefined : json['IosMinVersion'],
        'databaseStatus': json['database_status'] == null ? undefined : json['database_status'],
        'filestoreStatus': json['filestore_status'] == null ? undefined : json['filestore_status'],
        'status': json['status'] == null ? undefined : json['status'],
        'canReceiveNotifications': json['CanReceiveNotifications'] == null ? undefined : json['CanReceiveNotifications'],
    };
}
export function SystemStatusResponseToJSON(json) {
    return SystemStatusResponseToJSONTyped(json, false);
}
export function SystemStatusResponseToJSONTyped(value, ignoreDiscriminator = false) {
    if (value == null) {
        return value;
    }
    return {
        'AndroidLatestVersion': value['androidLatestVersion'],
        'AndroidMinVersion': value['androidMinVersion'],
        'DesktopLatestVersion': value['desktopLatestVersion'],
        'DesktopMinVersion': value['desktopMinVersion'],
        'IosLatestVersion': value['iosLatestVersion'],
        'IosMinVersion': value['iosMinVersion'],
        'database_status': value['databaseStatus'],
        'filestore_status': value['filestoreStatus'],
        'status': value['status'],
        'CanReceiveNotifications': value['canReceiveNotifications'],
    };
}
