export interface UserNotifyProps {
    email?: string;
    push?: string;
    desktop?: string;
    desktopSound?: string;
    mentionKeys?: string;
    channel?: string;
    firstName?: string;
    desktopThreads?: string;
    pushThreads?: string;
    desktopNotificationSound?: string;
}
export declare function instanceOfUserNotifyProps(value: object): value is UserNotifyProps;
export declare function UserNotifyPropsFromJSON(json: any): UserNotifyProps;
export declare function UserNotifyPropsFromJSONTyped(json: any, ignoreDiscriminator: boolean): UserNotifyProps;
export declare function UserNotifyPropsToJSON(json: any): UserNotifyProps;
export declare function UserNotifyPropsToJSONTyped(value?: UserNotifyProps | null, ignoreDiscriminator?: boolean): any;
