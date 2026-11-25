export interface Reaction {
    userId: string;
    postId: string;
    emojiName: string;
    createAt: number;
    channelId: string;
    updateAt: number;
    deleteAt: number;
    remoteId: string | null;
}
export declare function instanceOfReaction(value: object): value is Reaction;
export declare function ReactionFromJSON(json: any): Reaction;
export declare function ReactionFromJSONTyped(json: any, ignoreDiscriminator: boolean): Reaction;
export declare function ReactionToJSON(json: any): Reaction;
export declare function ReactionToJSONTyped(value?: Reaction | null, ignoreDiscriminator?: boolean): any;
