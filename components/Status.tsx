import React from "react";

import {TokenPairStatus} from "../types/types";

const Status: React.FC<{ status: TokenPairStatus, method: string }> = ({ status, method }) => {

    let statusStr = "Unverified"
    let statusClass = "status-unverified"

    switch(status) {
        case TokenPairStatus.Unverified:
        default:
            statusStr = "Unverified"
            statusClass = "status-unverified"
            break
        case TokenPairStatus.ManualVerified:
            statusStr = "VERIFIED";
            statusClass = "status-verified"
            break;
        case TokenPairStatus.AutoVerified:
            statusStr = "AUTO-VERIFIED";
            statusClass = "status-verified"
            break;
        case TokenPairStatus.NeedsReview:
            statusStr = "Needs Review";
            statusClass = "status-review"
            break;
        case TokenPairStatus.AutoRejected:
            statusStr = "Auto-Rejected";
            statusClass = "status-not-usable"
            break;
        case TokenPairStatus.ManualRejected:
            statusStr = "Rejected";
            statusClass = "status-not-usable"
            break;
        case TokenPairStatus.Duplicate:
            statusStr = "Duplicate";
            statusClass = "status-dupe"
            break;
        case TokenPairStatus.NotCurrentlyUsable:
            statusStr = "Fake/Bad/Not Usable";
            statusClass = "status-not-usable"
            break;
    }
    return (
        <>
            <span className={statusClass}>{statusStr}</span>
            {method && <> ({method})</>}
            <style jsx>{`

                .status-verified {
                    font-weight: bold;
                    color: green;
                }

                .status-dupe {
                    font-weight: bold;
                    color: orange;
                }

                .status-not-usable {
                    font-weight: bold;
                    color: red;
                }

                .status-review {
                    font-weight: bold;
                    color: #1565c0;
                }

                .status-unverified {
                    font-weight: bold;
                    color: #444;
                }
            `}</style>
        </>
    )

}

export default Status;
