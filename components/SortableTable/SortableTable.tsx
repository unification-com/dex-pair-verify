import TableBody from "./TableBody";
import TableHead from "./TableHead";
import { useSortableTable } from "../../hooks/useSortableTable";
import {useState} from "react";

const SortableTable = ({ caption, data, columns }) => {

    const [tableData, handleSorting, handleFiltering] = useSortableTable(data, columns);

    const filter = (event: React.ChangeEvent<HTMLInputElement>) => {
        const value = event.target.value
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
                {caption && <caption>
                    {caption}
                </caption>}
                <TableHead columns={columns} handleSorting={handleSorting}/>
                <TableBody columns={columns} tableData={tableData}/>
            </table>
        </>
    );
};

export default SortableTable;
