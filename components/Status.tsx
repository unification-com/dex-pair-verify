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
            statusClass = "status-good"
            break;
        case 2:
            statusStr = "Fake/Dupe";
            statusClass = "status-bad"
            break;
    }
    return (
        <>
            <span className={statusClass}>{statusStr}</span>
            <style jsx>{`

                .status-good {
                    font-weight: bold;
                    color: green;
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
