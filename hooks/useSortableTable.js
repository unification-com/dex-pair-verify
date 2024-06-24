import { useState } from "react";

function getDefaultSorting(defaultTableData, columns) {
    const sorted = [...defaultTableData].sort((a, b) => {
        const filterColumn = columns.filter((column) => column.sortbyOrder);

        // Merge all array objects into single object and extract accessor and sortbyOrder keys
        let { accessor = "id", sortbyOrder = "asc" } = Object.assign(
            {},
            ...filterColumn
        );

        if (a[accessor] === null) return 1;
        if (b[accessor] === null) return -1;
        if (a[accessor] === null && b[accessor] === null) return 0;

        const ascending = a[accessor]
            .toString()
            .localeCompare(b[accessor].toString(), "en", {
                numeric: true,
            });

        return sortbyOrder === "asc" ? ascending : -ascending;
    });
    return sorted;
}
export const useSortableTable = (data, columns) => {
    const [tableData, setTableData] = useState(getDefaultSorting(data, columns));

    const handleFiltering = (filter) => {
        if (filter) {
            setTableData([ ...data.filter(row => {
                return Object.values(row)
                    .join('')
                    .toLowerCase()
                    .includes(filter.toLowerCase())
            }) ])
        } else {
            setTableData(data)
        }
    }

    const handleSorting = (sortField, sortOrder) => {
        if (sortField) {
            const sfArr = sortField.split(".")
            const sorted = [...tableData].sort((a, b) => {
                let as = a
                let bs = b
                for(let i = 0; i < sfArr.length; i += 1) {
                    as = as[sfArr[i]]
                    bs = bs[sfArr[i]]
                }
                if (as === null) return 1;
                if (bs === null) return -1;
                if (as === null && bs === null) return 0;
                return (
                    as.toString().localeCompare(bs.toString(), "en", {
                        numeric: true,
                    }) * (sortOrder === "asc" ? 1 : -1)
                );
            });
            setTableData(sorted);
        }
    };

    return [tableData, handleSorting, handleFiltering];
};
