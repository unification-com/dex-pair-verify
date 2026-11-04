import {signOut} from "next-auth/react";
import React from "react";

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
