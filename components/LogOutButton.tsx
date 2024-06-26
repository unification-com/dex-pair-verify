import React from "react";
import {signOut} from "next-auth/react";

const LogOutButton: React.FC = () => {
    return (
        <>
            <button onClick={() => signOut()}>
                <a>Log out</a>
            </button>
        </>
    )

}

export default LogOutButton;
