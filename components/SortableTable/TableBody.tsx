import TableCell from "./TableCell";

const TableBody = ({ tableData, columns }) => {
    return (
        <tbody>
        {tableData.map((rowData) => {
            return (
                <tr key={rowData.id}>
                    {columns.map((column) => {
                        return <TableCell column={column} data={rowData} id={rowData.id} />;
                    })}
                </tr>
            );
        })}
        </tbody>
    );
};

export default TableBody;
