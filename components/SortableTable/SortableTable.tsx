import TableBody from "./TableBody";
import TableHead from "./TableHead";
import { useSortableTable } from "../../hooks/useSortableTable";
import {useState} from "react";

const SortableTable = ({ caption, data, columns }) => {

    const [tableData, handleSorting, handleFiltering] = useSortableTable(data, columns);

    const filter = (event: React.ChangeEvent<HTMLInputElement>) => {
        const value = event.target.value
        // @ts-ignore
        handleFiltering(value)
    }

    return (
        <>
            <input
                type="text"
                placeholder="Filter items"
                onChange={filter}
            />
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
