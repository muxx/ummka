export interface Team {
    id?: string;
    createAt?: number;
    updateAt?: number;
    deleteAt?: number;
    displayName?: string;
    name?: string;
    description?: string;
    email?: string;
    type?: string;
    allowedDomains?: string;
    inviteId?: string;
    allowOpenInvite?: boolean;
    policyId?: string;
    groupConstrained?: boolean | null;
}
export declare function instanceOfTeam(value: object): value is Team;
export declare function TeamFromJSON(json: any): Team;
export declare function TeamFromJSONTyped(json: any, ignoreDiscriminator: boolean): Team;
export declare function TeamToJSON(json: any): Team;
export declare function TeamToJSONTyped(value?: Team | null, ignoreDiscriminator?: boolean): any;
