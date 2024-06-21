import Router from "next/router";
import React from "react";
import {NumericFormat} from "react-number-format";
import Status from "../Status";

const TableCell = ({ data, column, id }) => {

    let cellData = null

    const accessorArray = column.accessor.split(".")
    let d = data
    for(let i = 0; i < accessorArray.length; i += 1) {
        d = d[accessorArray[i]]
    }

    switch(column.cellType) {
        case "display":
        default:
            cellData = d ? d : "";
            break
        case "number":
            cellData = <NumericFormat displayType="text" thousandSeparator="," value={d}/>;
            break
        case "usd":
            cellData = <>$<NumericFormat displayType="text" thousandSeparator="," value={d}/></>
            break
        case "percent":
            cellData = <><NumericFormat displayType="text" thousandSeparator="," value={d}/>%</>;
            break
        case "status":
            cellData = <><Status status={d} method={""} /></>
            break
        case "edit_button":
            cellData = <button onClick={() => Router.push(column.router.url, column.router.as.replace("__ID__", d))}>
                <strong>Edit</strong>
            </button>
            break
    }

    return (
        <td key={`${column.accessor}_${id}`}>{cellData}</td>
    );
};

export default TableCell;
