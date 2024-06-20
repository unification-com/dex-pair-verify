import React from "react";

const Status: React.FC<{ status: number }> = ({ status }) => {

    let statusStr = "Unverified"
    let statusClass = "status-unverified"

    switch(status) {
        case 0:
        default:
            statusStr = "Unverified"
            statusClass = "status-unverified"
            break
        case 1:
            statusStr = "VERIFIED";
            statusClass = "status-verified"
            break;
        case 2:
            statusStr = "Duplicate";
            statusClass = "status-dupe"
            break;
        case 3:
            statusStr = "Fake/Bad";
            statusClass = "status-bad"
            break;
    }
    return (
        <>
            <span className={statusClass}>{statusStr}</span>
            <style jsx>{`

                .status-verified {
                    font-weight: bold;
                    color: green;
                }

                .status-dupe {
                    font-weight: bold;
                    color: orange;
                }

                .status-bad {
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
