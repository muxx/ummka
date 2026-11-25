import type { User } from './User.js';
import type { Post } from './Post.js';
export interface UserThread {
    id?: string;
    replyCount?: number;
    lastReplyAt?: number;
    lastViewedAt?: number;
    participants?: Array<User>;
    post?: Post;
    unreadReplies?: number;
    unreadMentions?: number;
    isUrgent?: boolean;
    deleteAt?: number;
}
export declare function instanceOfUserThread(value: object): value is UserThread;
export declare function UserThreadFromJSON(json: any): UserThread;
export declare function UserThreadFromJSONTyped(json: any, ignoreDiscriminator: boolean): UserThread;
export declare function UserThreadToJSON(json: any): UserThread;
export declare function UserThreadToJSONTyped(value?: UserThread | null, ignoreDiscriminator?: boolean): any;
