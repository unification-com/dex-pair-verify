
export type ExtendedSessionUser = {
    name: string,
    email: string,
    image: string,
    isAuthorised: boolean,
}

// Client-safe mirror of the Prisma `TokenPairStatus` enum (schema.prisma).
// Declared as a string enum so client components can import it without pulling
// @prisma/client (and its query engine) into the browser bundle. The string
// values MUST match the Prisma enum member names exactly.
export enum TokenPairStatus {
    Unverified = "Unverified",
    AutoVerified = "AutoVerified",
    AutoRejected = "AutoRejected",
    ManualVerified = "ManualVerified",
    ManualRejected = "ManualRejected",
    NeedsReview = "NeedsReview",
    Duplicate = "Duplicate",
    NotCurrentlyUsable = "NotCurrentlyUsable",
}

// Client-safe mirror of the Prisma `VerificationMethod` enum (schema.prisma).
export enum VerificationMethod {
    Import = "Import",
    Manual = "Manual",
    Cascade = "Cascade",
    Auto = "Auto",
}

// Client-safe mirror of the Prisma `CandidateStatus` enum (schema.prisma).
export enum CandidateStatus {
    Pending = "Pending",
    Enabled = "Enabled",
    Rejected = "Rejected",
}
