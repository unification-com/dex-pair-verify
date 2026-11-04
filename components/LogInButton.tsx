import { signIn } from "next-auth/react";
import React from "react";

// Operator log-in (GitHub OAuth). Shown in the public shell footer; non-allow-listed
// users are rejected at sign-in (lib/adminAllow) and stay on the public view.
const LogInButton: React.FC = () => (
  <button onClick={() => signIn("github")} className="btn btn-primary btn-sm" title="Operator log in">
    Log in
  </button>
);

export default LogInButton;
