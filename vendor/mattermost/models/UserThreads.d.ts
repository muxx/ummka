import type { UserThread } from './UserThread.js';
export interface UserThreads {
    total?: number;
    threads?: Array<UserThread> | null;
    totalUnreadThreads?: number;
    totalUnreadMentions?: number;
    totalUnreadUrgentMentions?: number;
}
export declare function instanceOfUserThreads(value: object): value is UserThreads;
export declare function UserThreadsFromJSON(json: any): UserThreads;
export declare function UserThreadsFromJSONTyped(json: any, ignoreDiscriminator: boolean): UserThreads;
export declare function UserThreadsToJSON(json: any): UserThreads;
export declare function UserThreadsToJSONTyped(value?: UserThreads | null, ignoreDiscriminator?: boolean): any;
