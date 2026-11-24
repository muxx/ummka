import type { FileInfo } from './FileInfo.js';
import type { PostMetadataImagesValue } from './PostMetadataImagesValue.js';
import type { Emoji } from './Emoji.js';
import type { PostMetadataEmbedsInner } from './PostMetadataEmbedsInner.js';
import type { PostAcknowledgement } from './PostAcknowledgement.js';
import type { Reaction } from './Reaction.js';
import type { PostMetadataPriority } from './PostMetadataPriority.js';
export interface PostMetadata {
    embeds?: Array<PostMetadataEmbedsInner>;
    emojis?: Array<Emoji>;
    files?: Array<FileInfo>;
    images?: {
        [key: string]: PostMetadataImagesValue;
    };
    reactions?: Array<Reaction>;
    priority?: PostMetadataPriority;
    acknowledgements?: Array<PostAcknowledgement>;
}
export declare function instanceOfPostMetadata(value: object): value is PostMetadata;
export declare function PostMetadataFromJSON(json: any): PostMetadata;
export declare function PostMetadataFromJSONTyped(json: any, ignoreDiscriminator: boolean): PostMetadata;
export declare function PostMetadataToJSON(json: any): PostMetadata;
export declare function PostMetadataToJSONTyped(value?: PostMetadata | null, ignoreDiscriminator?: boolean): any;
