import React from "react";


import TableBody from "./TableBody";
import TableHead from "./TableHead";
import { useSortableTable } from "../../hooks/useSortableTable";

const SortableTable = ({ caption, data, columns, useFilter }) => {

    const [tableData, handleSorting, handleFiltering] = useSortableTable(data, columns);

    const filter = (event: React.ChangeEvent<HTMLInputElement>) => {
        const value = event.target.value
        // @ts-ignore — useSortableTable returns a wider tuple than TS infers
        handleFiltering(value)
    }

    return (
        <>
            {(useFilter === true) && <input
                type="text"
                placeholder="Filter items"
                onChange={filter}
            />}
            <table className="table">
                {
                    caption ? (<caption>{caption}</caption>) : null
                }
                <TableHead
                    key={`table_head`}
                    columns={columns}
                    handleSorting={handleSorting}
                />
                <TableBody
                    key={`_table_body`}
                    columns={columns}
                    tableData={tableData}
                />
            </table>
        </>
    );
};

export default SortableTable;
