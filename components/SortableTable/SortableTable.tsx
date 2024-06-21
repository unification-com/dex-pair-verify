import TableBody from "./TableBody";
import TableHead from "./TableHead";
import { useSortableTable } from "../../hooks/useSortableTable";

const SortableTable = ({ caption, data, columns }) => {

    const [tableData, handleSorting] = useSortableTable(data, columns);

    return (
        <>
            <table className="table">
                { caption && <caption>
                    {caption}
                </caption>}
                <TableHead columns={columns} handleSorting={handleSorting} />
                <TableBody columns={columns} tableData={tableData} />
            </table>
        </>
    );
};

export default SortableTable;
