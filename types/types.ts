
export type ExtendedSessionUser = {
    name: string,
    email: string,
    image: string,
    isAuthotised: boolean,
}

export enum TokenPairStatus {
    Unverified,
    Verified,
    Duplicate,
    NotCurrentlyUsable,
}
