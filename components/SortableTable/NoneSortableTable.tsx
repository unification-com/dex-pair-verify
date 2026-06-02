import React, {useEffect, useState} from "react";

import TableBody from "./TableBody";
import TableHead from "./TableHead";

const NoneSortableTable = ({ caption, data, columns }) => {

    const [tableData, setTableData] = useState(data);

    useEffect(() => {
        setTableData(data)
    }, [data]);

    return (
        <>
            <table className="table">
                {
                    caption ? (<caption>{caption}</caption>) : null
                }
                <TableHead
                    key={`table_head`}
                    columns={columns}
                    handleSorting={function(){}}
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

export default NoneSortableTable;
