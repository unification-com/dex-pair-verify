import TableBody from "./TableBody";
import TableHead from "./TableHead";
import React, {useState} from "react";

const NoneSortableTable = ({ caption, data, columns }) => {

    const [tableData, setTableData] = useState(data);

    React.useEffect(() => {
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
