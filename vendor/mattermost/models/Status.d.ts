export interface Status {
    userId?: string;
    status?: string;
    manual?: boolean;
    lastActivityAt?: number;
    dndEndTime?: number;
}
export declare function instanceOfStatus(value: object): value is Status;
export declare function StatusFromJSON(json: any): Status;
export declare function StatusFromJSONTyped(json: any, ignoreDiscriminator: boolean): Status;
export declare function StatusToJSON(json: any): Status;
export declare function StatusToJSONTyped(value?: Status | null, ignoreDiscriminator?: boolean): any;
