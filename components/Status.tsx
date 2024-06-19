import React from "react";

const Status: React.FC<{ status: number }> = ({ status }) => {

    let statusStr = "Unverified"
    let statusClass = ""

    switch(status) {
        case 0:
        default:
            statusStr = "Unverified";
            break
        case 1:
            statusStr = "GOOD";
            statusClass = "status-good"
            break;
        case 2:
            statusStr = "BAD";
            statusClass = "status-bad"
            break;
    }
    return (
        <>
            <span className={statusClass}>{statusStr}</span>
            <style jsx>{`

                .status-good {
                    font-weight: bold;
                    color: green
                }

                .status-bad {
                    font-weight: bold;
                    color: red
                }
            `}</style>
        </>
    )

}

export default Status;
