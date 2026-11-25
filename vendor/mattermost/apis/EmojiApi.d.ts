import * as runtime from '../runtime.js';
import { type Emoji } from '../models/Emoji.js';
export interface GetEmojiByNameRequest {
    emojiName: string;
}
export declare class EmojiApi extends runtime.BaseAPI {
    getEmojiByNameRequestOpts(requestParameters: GetEmojiByNameRequest): Promise<runtime.RequestOpts>;
    getEmojiByNameRaw(requestParameters: GetEmojiByNameRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<runtime.ApiResponse<Emoji>>;
    getEmojiByName(requestParameters: GetEmojiByNameRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<Emoji>;
}
