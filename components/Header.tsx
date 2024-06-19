import React from "react";
import NavBar from "./NavBar";

const Header: React.FC = () => {
    let left = (
    <div className="left">
      <NavBar />
    </div>
  );

  let right = null;

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
