import React from "react";
import {TokenPairStatus} from "../types/types";

const Status: React.FC<{ status: number, method: string }> = ({ status, method }) => {

    let statusStr = "Unverified"
    let statusClass = "status-unverified"

    switch(status) {
        case TokenPairStatus.Unverified:
        default:
            statusStr = "Unverified"
            statusClass = "status-unverified"
            break
        case TokenPairStatus.Verified:
            statusStr = "VERIFIED";
            statusClass = "status-verified"
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
                
                .status-unverified {
                    font-weight: bold;
                    color: #444;
                }
            `}</style>
        </>
    )

}

export default Status;
