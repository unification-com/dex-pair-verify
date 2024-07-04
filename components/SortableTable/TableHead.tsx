import { useState } from "react";

const TableHead = ({ columns, handleSorting }) => {
    const [sortField, setSortField] = useState("");
    const [order, setOrder] = useState("asc");

    const handleSortingChange = (accessor) => {
        const sortOrder =
            accessor === sortField && order === "asc" ? "desc" : "asc";
        setSortField(accessor);
        setOrder(sortOrder);
        handleSorting(accessor, sortOrder);
    };

    return (
        <thead>
        <tr>
            {columns.map(({label, accessor, sortable}, idx) => {
                const cl = sortable
                    ? sortField === accessor && order === "asc"
                        ? "up"
                        : sortField === accessor && order === "desc"
                            ? "down"
                            : "default"
                    : "";
                return (
                    <th
                        key={`${idx}_${accessor}`}
                        onClick={sortable ? () => handleSortingChange(accessor) : null}
                        className={cl}
                    >
                        {label}
                    </th>
                );
            })}
        </tr>
        </thead>
    );
};

export default TableHead;
