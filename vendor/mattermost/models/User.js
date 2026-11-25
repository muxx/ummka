import { TimezoneFromJSON, TimezoneToJSON, } from './Timezone.js';
import { UserNotifyPropsFromJSON, UserNotifyPropsToJSON, } from './UserNotifyProps.js';
export function instanceOfUser(value) {
    return true;
}
export function UserFromJSON(json) {
    return UserFromJSONTyped(json, false);
}
export function UserFromJSONTyped(json, ignoreDiscriminator) {
    if (json == null) {
        return json;
    }
    return {
        'id': json['id'] == null ? undefined : json['id'],
        'createAt': json['create_at'] == null ? undefined : json['create_at'],
        'updateAt': json['update_at'] == null ? undefined : json['update_at'],
        'deleteAt': json['delete_at'] == null ? undefined : json['delete_at'],
        'username': json['username'] == null ? undefined : json['username'],
        'firstName': json['first_name'] == null ? undefined : json['first_name'],
        'lastName': json['last_name'] == null ? undefined : json['last_name'],
        'nickname': json['nickname'] == null ? undefined : json['nickname'],
        'email': json['email'] == null ? undefined : json['email'],
        'emailVerified': json['email_verified'] == null ? undefined : json['email_verified'],
        'authService': json['auth_service'] == null ? undefined : json['auth_service'],
        'roles': json['roles'] == null ? undefined : json['roles'],
        'locale': json['locale'] == null ? undefined : json['locale'],
        'notifyProps': json['notify_props'] == null ? undefined : UserNotifyPropsFromJSON(json['notify_props']),
        'props': json['props'] == null ? undefined : json['props'],
        'lastPasswordUpdate': json['last_password_update'] == null ? undefined : json['last_password_update'],
        'lastPictureUpdate': json['last_picture_update'] == null ? undefined : json['last_picture_update'],
        'failedAttempts': json['failed_attempts'] == null ? undefined : json['failed_attempts'],
        'mfaActive': json['mfa_active'] == null ? undefined : json['mfa_active'],
        'timezone': json['timezone'] == null ? undefined : TimezoneFromJSON(json['timezone']),
        'termsOfServiceId': json['terms_of_service_id'] == null ? undefined : json['terms_of_service_id'],
        'termsOfServiceCreateAt': json['terms_of_service_create_at'] == null ? undefined : json['terms_of_service_create_at'],
        'position': json['position'] == null ? undefined : json['position'],
        'isBot': json['is_bot'] == null ? undefined : json['is_bot'],
        'remoteId': json['remote_id'] == null ? undefined : json['remote_id'],
    };
}
export function UserToJSON(json) {
    return UserToJSONTyped(json, false);
}
export function UserToJSONTyped(value, ignoreDiscriminator = false) {
    if (value == null) {
        return value;
    }
    return {
        'id': value['id'],
        'create_at': value['createAt'],
        'update_at': value['updateAt'],
        'delete_at': value['deleteAt'],
        'username': value['username'],
        'first_name': value['firstName'],
        'last_name': value['lastName'],
        'nickname': value['nickname'],
        'email': value['email'],
        'email_verified': value['emailVerified'],
        'auth_service': value['authService'],
        'roles': value['roles'],
        'locale': value['locale'],
        'notify_props': UserNotifyPropsToJSON(value['notifyProps']),
        'props': value['props'],
        'last_password_update': value['lastPasswordUpdate'],
        'last_picture_update': value['lastPictureUpdate'],
        'failed_attempts': value['failedAttempts'],
        'mfa_active': value['mfaActive'],
        'timezone': TimezoneToJSON(value['timezone']),
        'terms_of_service_id': value['termsOfServiceId'],
        'terms_of_service_create_at': value['termsOfServiceCreateAt'],
        'position': value['position'],
        'is_bot': value['isBot'],
        'remote_id': value['remoteId'],
    };
}
