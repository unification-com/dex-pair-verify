import TableCell from "./TableCell";

const TableBody = ({ tableData, columns }) => {
    return (
        <tbody>
        {tableData.map((rowData) => {
            return (
                <tr key={`row_${rowData.id}`}>
                    {columns.map((column, idx) => {
                        return <TableCell column={column} data={rowData} key={`cell_${idx}_${column.accessor}_${rowData.id}`} />;
                    })}
                </tr>
            );
        })}
        </tbody>
    );
};

export default TableBody;
