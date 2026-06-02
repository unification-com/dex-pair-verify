import React from "react";

import NavBar from "./NavBar";

const Header: React.FC = () => {
    const left = (
    <div className="left">
      <NavBar />
    </div>
  );

  const right = null;

  return (
    <nav>
      {left}
      {right}
      <style jsx>{`
        nav {
          display: flex;
          padding: 2rem;
          align-items: center;
        }
      `}</style>
    </nav>
  );
};

export default Header;
