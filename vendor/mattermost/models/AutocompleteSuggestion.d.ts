export interface AutocompleteSuggestion {
    complete?: string;
    suggestion?: string;
    hint?: string;
    description?: string;
    iconData?: string;
}
export declare function instanceOfAutocompleteSuggestion(value: object): value is AutocompleteSuggestion;
export declare function AutocompleteSuggestionFromJSON(json: any): AutocompleteSuggestion;
export declare function AutocompleteSuggestionFromJSONTyped(json: any, ignoreDiscriminator: boolean): AutocompleteSuggestion;
export declare function AutocompleteSuggestionToJSON(json: any): AutocompleteSuggestion;
export declare function AutocompleteSuggestionToJSONTyped(value?: AutocompleteSuggestion | null, ignoreDiscriminator?: boolean): any;
