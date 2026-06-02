
export type ExtendedSessionUser = {
    name: string,
    email: string,
    image: string,
    isAuthorised: boolean,
}

export enum TokenPairStatus {
    Unverified,
    Verified,
    Duplicate,
    NotCurrentlyUsable,
}
