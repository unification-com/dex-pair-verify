import TableCell from "./TableCell";

const TableBody = ({ tableData, columns }) => {
    return (
        <tbody>
        {tableData.map((rowData) => {
            return (
                <tr key={`row_${rowData.id}`}>
                    {columns.map((column) => {
                        return <TableCell column={column} data={rowData} key={`cell_${column.accessor}_${rowData.id}`} />;
                    })}
                </tr>
            );
        })}
        </tbody>
    );
};

export default TableBody;
