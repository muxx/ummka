export interface AutocompleteCommand {
    id?: string;
    trigger?: string;
    displayName?: string;
    autoComplete?: boolean;
    autoCompleteHint?: string;
    autoCompleteDesc?: string;
    iconUrl?: string;
    autocompleteIconData?: string;
}
export declare function instanceOfAutocompleteCommand(value: object): value is AutocompleteCommand;
export declare function AutocompleteCommandFromJSON(json: any): AutocompleteCommand;
export declare function AutocompleteCommandFromJSONTyped(json: any, ignoreDiscriminator: boolean): AutocompleteCommand;
export declare function AutocompleteCommandToJSON(json: any): AutocompleteCommand;
export declare function AutocompleteCommandToJSONTyped(value?: AutocompleteCommand | null, ignoreDiscriminator?: boolean): any;
