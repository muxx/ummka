export interface Emoji {
    id?: string;
    creatorId?: string;
    name?: string;
    createAt?: number;
    updateAt?: number;
    deleteAt?: number;
}
export declare function instanceOfEmoji(value: object): value is Emoji;
export declare function EmojiFromJSON(json: any): Emoji;
export declare function EmojiFromJSONTyped(json: any, ignoreDiscriminator: boolean): Emoji;
export declare function EmojiToJSON(json: any): Emoji;
export declare function EmojiToJSONTyped(value?: Emoji | null, ignoreDiscriminator?: boolean): any;
