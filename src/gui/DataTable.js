'use strict';

import './DataTable.css'; // IMPORTANT!!

var Clusterize = require('clusterize.js');
const avu = Autodesk.Viewing.UI;
const AGGREGATE_MIN = 'MIN';
const AGGREGATE_MAX = 'MAX';
const AGGREGATE_SUM = 'SUM';
const AGGREGATE_AVG = 'AVG';
const AGGREGATE_COUNT = 'COUNT';
/**
 * UI component in LMV that can be added into the DockingPanels to create custom tables
 *
 * @class
 * @alias Autodesk.Viewing.UI.DataTable
 * @param {Autodesk.Viewing.UI.DockingPanel} dockingPanel  Instance of the Docking Panel
 */
export function DataTable(dockingPanel) {

    if(!(dockingPanel instanceof avu.DockingPanel)) {
        throw new Error('Invalid docking panel');
    }
    this.dockingPanel = dockingPanel;

    let _document = this.dockingPanel.getDocument();
    this.datatableDiv = _document.createElement("div");
    this.datatableDiv.setAttribute('id', 'datatable');
    this.datatableDiv.setAttribute('class', 'datatable');
    dockingPanel.container.appendChild(this.datatableDiv);

    if(dockingPanel.footerInstance) {
      // set the resize handler
     dockingPanel.footerInstance.resizeCallback = this._fitHeaderColumns.bind(this);
    }
    this.groupedByColumn = false;
    this.aggregated = false;
}

/**
 * Creates the table column
 *
 * @param {Array} columndata - The dataset in array and represents the column data
 * @private 
 */
DataTable.prototype._createColumns = function(columndata) {
    let _document = this.dockingPanel.getDocument();
    var columnDiv = _document.createElement('div');
    columnDiv.setAttribute('id', 'columnArea');
    columnDiv.setAttribute('class', 'clusterize-headers');
    var table = 
        '<table id="headersArea">' +
            '<thead>' +
                '<tr id ="columnRow">' +
                '</tr>' +
            '</thead>' +
        '</table>';

    columnDiv.innerHTML = table;
    this.datatableDiv.appendChild(columnDiv);

    var tRow = columnDiv.querySelector('tr');
    columndata.forEach(function(cellDaata){
        var cell = _document.createElement('th');
        cell.appendChild(_document.createTextNode(cellDaata));
        tRow.appendChild(cell);
    });
    table = this.datatableDiv.querySelector('table');
    this._makeTableSortable(table);
};

/**
 * Creates the table rows
 *
 * @private
 */
DataTable.prototype._createRows = function() {
    let _document = this.dockingPanel.getDocument();
    var rowDiv = _document.createElement('div');
    var html = 
      '<div id="scrollArea" class="clusterize-scroll">' +
          '<table id="bodyArea" class="table-striped">' +
              '<tbody id="contentArea" class="clusterize-content">' +
                  '<tr class="clusterize-no-data">' +
                      '<td>Loading data…</td>' +
                  '</tr>' +
              '</tbody>' +
          '</table>' +
      '</div>';
    rowDiv.innerHTML = html;
    this.datatableDiv.appendChild(rowDiv);
};

/**
 * Sets the table data
 *
 * @param {Array<Array[]>} rowdata - The dataset in array of arrays and represents a set of rows
 * @param {Array} columndata - The dataset in array and represents the column data
 * @alias Autodesk.Viewing.UI.DataTable#setData
 */
DataTable.prototype.setData = function(rowdata, columndata) {    
    // Check if the column length is same as the row length
    if(columndata.length !== rowdata[0].length)
    throw new Error('Column length should be same as the row length');

    // Separate the column and row data
    this._createColumns(columndata);
    this._createRows();

    var self = this;
    this.rowData = rowdata;
    this.clusterize = new Clusterize({
      rows: this.rowData.map(function(row) {
        return "<tr>" +
          row.map(function(col) {
            return '<td>' + col + '</td>';
          }).join(" ") +
        "</tr>";
        }),
      scrollId: 'scrollArea',
      contentId: 'contentArea',
      callbacks: {
        clusterChanged: function() {
          self._fitHeaderColumns();
          self._syncHeaderWidth();
          if(self.groupedByColumn) 
              self._updateClusterGroup();
        }
      }
    });

    /**
     * Update header left offset on scroll
     */
    var scroll = this.datatableDiv.querySelector('.clusterize-scroll');
    scroll.addEventListener('scroll', function() {
        var scrollLeft = this.scrollLeft;
        setHeaderLeftMargin(scrollLeft);
    });
    var setHeaderLeftMargin = function(scrollLeft) {
        var headers = self.datatableDiv.querySelector('#headersArea');
        headers.style.setProperty('margin-left', -scrollLeft + 'px');
    };
};

/**
 * Destroys the table instance
 *
 * @alias Autodesk.Viewing.UI.DataTable#destroyTable
 */
DataTable.prototype.destroyTable = function() {
  this.clusterize.destroy(true);
  this.clusterize = null;
  this.rowData = null;
  this.groupedByColumn = false;
};

/**
 * Make the table sortable for the given table
 *
 * @param {*} table - table data
 * @private
 */
DataTable.prototype._makeTableSortable = function(table) {
    var self = this;
    var th = table.tHead, i;
    th && th.rows[0] && (th = th.rows[0].cells);
    if (th) {
      i = th.length;
    } else {
      return; // if no `<thead>` then do nothing
    }
    // Loop through every <th> inside the header
    while (--i >= 0) {
        (function (i) {
            var dir = 1;

            // Append click listener to sort
            th[i].addEventListener('click', function () {
                self._sortTable(i, (dir = 1 - dir));
            });
        }(i));
    }
};

/**
 * Sorts based on the column data
 *
 * @param {number} col - column index
 * @param {number} reverse - reverse index
 * @private
 */
DataTable.prototype._sortTable = function(col, reverse) {
    var tr = this.rowData;
    
    if(!this.sortFunction) {
      this.restoreDefaultSortFunction();
    }
    var sortFunc = this.sortFunction && this.sortFunction.bind(this);
    tr = tr.sort(sortFunc(col, reverse));

    var rows = tr.map(function(row) {
      return "<tr>" +
        row.map(function(col) {
          return '<td>' + col + '</td>';
        }).join(" ") +
      "</tr>";
      });
    this.clusterize.update(rows);

    var table = this.datatableDiv.querySelector('#bodyArea');
    if(!table.classList.contains('table-striped')) 
        table.classList.add('table-striped');
};

/**
 * API to set the custom sorting function
 *
 * @param {Function} sortFunc - custom sort function for the table dataset
 * @alias Autodesk.Viewing.UI.DataTable#setSortFunction
 */
DataTable.prototype.setSortFunction = function(sortFunc) {
    this.sortFunction = sortFunc;
};

/**
 * API to get the custom sorting function
 *
 * @returns {Function} custom sort function set by the setSortFunction method
 * @alias Autodesk.Viewing.UI.DataTable#getSortFunction
 */
DataTable.prototype.getSortFunction = function() {
    return this.sortFunction;
};

/**
 * API to set the default sorting function
 *
 * @alias Autodesk.Viewing.UI.DataTable#restoreDefaultSortFunction
 */
DataTable.prototype.restoreDefaultSortFunction = function() {
    var defaultSortFunc = (function (col, reverse) {
      reverse = -((+reverse) || -1);
      return function(a,b) {
          return reverse * (
              a[col].localeCompare(b[col])
          );
      };
    });
    this.sortFunction = defaultSortFunc;
};

/**
 * Get the group by given column
 *
 * @param {number} col - column index
 * @returns {number[]} rowGroups - an array of grouped data, where each group contains numbers that represent the row-indices of the original table dataset.
 * @alias Autodesk.Viewing.UI.DataTable#getGroupByColumn
 */
DataTable.prototype.getGroupByColumn = function(col) { 
    var rowData = this.rowData;
    var rowGroups = {};
    for(let i =0; i< rowData.length; i++) {
        var row = rowData[i];
        var id = row[col];
        if(!rowGroups[id]) rowGroups[id] = [];
        rowGroups[id].push(i);
    }
    return rowGroups;
};

/**
 * Group by given column
 *
 * @param {number} col - column index
 * @alias Autodesk.Viewing.UI.DataTable#groupByColumn
 */
DataTable.prototype.groupByColumn = function(col) {  
    var rowData = this.rowData;
    var rowGroups = {};
    for(let i =0; i< rowData.length; i++) {
        let row = rowData[i];
        var id = row[col];
        if(!rowGroups[id]) rowGroups[id] = [];
        if(rowGroups[id].length > 0){
            row = "<tr class= 'subrow'>" + row.map(function(col) {
              return '<td>' + col + '</td>';
            }).join(" ") + 
            "</tr>";
        } else {
            const rowLen = row.length;
            var html = 
            '<span value="click">' +
            '</span>'; 
            row = "<tr class= 'parentrow'>" + row.map(function(col, i) {
              if(rowLen === i + 1) {
                return '<td>' + col + html + '</td>';
              } else {
                return '<td>' + col + '</td>';
              }
            }).join(" ") +
            "</tr>";
        }
        rowGroups[id].push(row);
    }

    var rowSet = [];
    for (let id in rowGroups) {
        var group = rowGroups[id];
        for (let j = 0; j < group.length; j++) {
            let row = group[j];
            rowSet.push(row);
        }
    }
    this.clusterize.update(rowSet);

    var table = this.datatableDiv.querySelector('#bodyArea');
    if(table.classList.contains('table-striped')) 
        table.classList.remove('table-striped');

    this.datatableDiv.querySelectorAll('.subrow').forEach(subRow => {
        this._slideDown(subRow);
        subRow.style.fontSize = 14 + 'px';
    });

    var _fitHeaderColumns = this._fitHeaderColumns.bind(this);
    var _expandContent = this._expandContent.bind(this);
    this.datatableDiv.querySelectorAll('span').forEach(row => {
        row.addEventListener('click', function(event) {
            _expandContent(this, event);
            _fitHeaderColumns();
        });
    });

    this._fitHeaderColumns(); 
    if(!this.groupedByColumn) this.groupedByColumn = true;
};

/**
 * Updates the clusterize
 *
 * @private
 */
DataTable.prototype._updateClusterGroup = function() {
    var _fitHeaderColumns = this._fitHeaderColumns.bind(this);
    var _expandContent = this._expandContent.bind(this);
    this.datatableDiv.querySelectorAll('span').forEach(row => {
        row.addEventListener('click', function(event) {
            _expandContent(this, event);
            _fitHeaderColumns();
        });
      });
    this.datatableDiv.querySelectorAll('.subrow').forEach(subRow => {
        this._slideDown(subRow);
        subRow.style.fontSize = 14 + 'px';
    });
};

/**
 * Expand the content for group by column
 *
 * @param self
 * @private
 */
DataTable.prototype._expandContent = function(self) {
    var collapsed = false;
    if(self.className === 'collapsed') {
      collapsed = true;
    }
    var fontSize = collapsed ? 14 : 0;
    var closestTr = self.closest('tr');
    var trSiblings = this._nextUntil(closestTr, ':not(.subrow)');
    for(let i =0; i< trSiblings.length; i++) {
        this._slideToggle(trSiblings[i], 500);
        trSiblings[i].style.fontSize = fontSize + 'px';
    }
    self.classList.toggle('collapsed');
};

/**
 * Gives the next subsequent rows for the given html element
 *
 * @param elem
 * @param selector
 * @param filter
 * @private
 */
DataTable.prototype._nextUntil = function(elem, selector, filter) {
    var siblings = [];  // Setup siblings array
    elem = elem.nextElementSibling;  // Get the next sibling element
    while (elem) {
        if (elem.matches(selector)) break;
        if (filter && !elem.matches(filter)) {
            elem = elem.nextElementSibling;
            continue;
        }
        siblings.push(elem);
        elem = elem.nextElementSibling;
    }
    return siblings;
};

/**
 * Slide toggle - toggles between slide up and slide down for the given html element
 *
 * @param element
 * @param duration
 * @private
 */
DataTable.prototype._slideToggle = function(element, duration) {
    let _window = this.dockingPanel.getWindow();
    if (_window.getComputedStyle(element).display === 'none') {
        return this._slideDown(element, duration);
    } else {
        return this._slideUp(element, duration);
    }
};

/**
 * Slide up the given html element
 *
 * @param element
 * @param duration
 * @private
 */
DataTable.prototype._slideUp = function(element, duration) {
    element.style.transitionProperty = 'height, margin, padding';
    element.style.transitionDuration = duration + 'ms';
    element.style.boxSizing = 'border-box';
    element.style.height = element.offsetHeight + 'px';
    element.offsetHeight;
    element.style.overflow = 'hidden';
    element.style.height = 0;
    element.style.paddingTop = 0;
    element.style.paddingBottom = 0;
    element.style.marginTop = 0;
    element.style.marginBottom = 0;
    // window.setTimeout( () => {
      element.style.display = 'none';
      element.style.removeProperty('height');
      element.style.removeProperty('padding-top');
      element.style.removeProperty('padding-bottom');
      element.style.removeProperty('margin-top');
      element.style.removeProperty('margin-bottom');
      element.style.removeProperty('overflow');
      element.style.removeProperty('transition-duration');
      element.style.removeProperty('transition-property');
    // }, duration);
};

/**
 * Slides down the given html element
 *
 * @param element
 * @param duration
 * @private
 */
DataTable.prototype._slideDown = function(element, duration) {
    let _window = this.dockingPanel.getWindow();
    element.style.removeProperty('display');
    let display = _window.getComputedStyle(element).display;

    if (display === 'none')
        display = 'block';

    element.style.display = display;
    let height = 21 + 'px';
    element.style.overflow = 'hidden';
    element.style.height = 0;
    element.style.paddingTop = 0;
    element.style.paddingBottom = 0;
    element.style.marginTop = 0;
    element.style.marginBottom = 0;
    element.offsetHeight;
    element.style.boxSizing = 'border-box';
    element.style.transitionProperty = "height, margin, padding";
    element.style.transitionDuration = duration + 'ms';
    element.style.height = height + 'px';
    element.style.removeProperty('padding-top');
    element.style.removeProperty('padding-bottom');
    element.style.removeProperty('margin-top');
    element.style.removeProperty('margin-bottom');
    _window.setTimeout( () => {
        element.style.removeProperty('height');
        element.style.removeProperty('overflow');
        element.style.removeProperty('transition-duration');
        element.style.removeProperty('transition-property');
    }, duration);
};

/**
 * Get aggregation based on the type for the given column
 *
 * @param {string} type - type of aggregation
 * @param {number} col - column index
 * @returns {string} the final result of the aggregation
 * @alias Autodesk.Viewing.UI.DataTable#getAggregate
 */
DataTable.prototype.getAggregate = function(type, col) {
    var rowData = this.rowData;
    var value = null;

    switch(type) {
        case AGGREGATE_MIN:
            value = getMin();
            break;
        case AGGREGATE_MAX:
            value = getMax();
            break;
        case AGGREGATE_SUM:
            value = getSum();     
            break;
        case AGGREGATE_AVG: 
            value = getAvg();
            break;
        case AGGREGATE_COUNT:
            value = getCount();
    }
    return value;

    /**
     *
     */
    function getMin() {
        var minValue = rowData[0][col];
        for(let i=1; i< rowData.length; i++) {
            if(minValue > rowData[i][col]) {
                minValue = rowData[i][col];
            }
        }
        return minValue? minValue: 0;
    }

    /**
     *
     */
    function getMax() {
        var maxValue = rowData[0][col];
        for(let i=1; i< rowData.length; i++) {
            if(maxValue < rowData[i][col]) {
                maxValue = rowData[i][col];
            }
        }
        return maxValue? maxValue: 0;
    }

    /**
     *
     */
    function getSum() {
        var sumValue = 0;
        for(let i=0; i< rowData.length; i++) {
            sumValue = sumValue + parseFloat(rowData[i][col]);
        }
        return sumValue? sumValue : 0;
    }

    /**
     *
     */
    function getAvg() {
        var avg = getSum() / (rowData.length);
        avg = parseFloat(avg);
        return avg? avg: 0;
    }

    /**
     *
     */
    function getCount() {
        return rowData.length;
    }
};

/**
 * Aggregate based on the type for the given column
 *
 * @param {string} type - type of aggregation
 * @param {number} col - column index
 * @alias Autodesk.Viewing.UI.DataTable#aggregate
 */
DataTable.prototype.aggregate = function(type, col) {
    var content = this.datatableDiv.querySelector('.clusterize-content');
    var firstRow = content.querySelector('tr:not(.clusterize-extra-row):not(.first)');
    if(!firstRow) {
        return;
    }
    var columnsWidth = [];

    for(var i=0; i< firstRow.children.length; i++) {
        columnsWidth.push(firstRow.children[i].clientWidth);
    }

    var result = this.getAggregate(type, col);

    let _document = this.dockingPanel.getDocument();
    if(!this.aggregated) {
        var aggregateDiv = _document.createElement('div');
        aggregateDiv.setAttribute('id', 'aggregate');
        aggregateDiv.setAttribute('class', 'aggregate-headers');
        var table = 
            '<table id="aggregateArea">' +
                '<tbody>' +
                '</tbody>' +
            '</table>';
    
        aggregateDiv.innerHTML = table;
        this.datatableDiv.appendChild(aggregateDiv);      
    }
    // populate the cell data
    var aggregatedTable = this.datatableDiv.querySelector('#aggregateArea');

    // If the specified aggregation already exists for the specified column then just return
    for(var k=0; k< aggregatedTable.rows.length; k++) {
        var cell = aggregatedTable.rows[k].cells[col];
        if(cell.innerText.indexOf(type) > -1) {
            return;
        }
    }
    // If the specified aggregation doesn't already exist for the specified column then
    // add it to the first available row
    for(var p=0; p< aggregatedTable.rows.length; p++) {
        var emptyCell = aggregatedTable.rows[p].cells[col];
        if(emptyCell.innerText.length === 0) {
            emptyCell.appendChild(_document.createTextNode(type + ': '));
            emptyCell.appendChild(_document.createTextNode(result));
            return;
        }
    }
    // If specified aggregation is performed for the first time then create a row
    var tRow = aggregatedTable.insertRow(aggregatedTable.rows.length);
    // Add the cell data based on the column that is aggregated
    for(var j=0; j< columnsWidth.length; j++) {
        var newCell = _document.createElement('td');
        tRow.appendChild(newCell);
        newCell.style.setProperty('min-width', columnsWidth[j] + 'px', 'important');
        if(j === col) {
            newCell.appendChild(_document.createTextNode(type + ': '));
            newCell.appendChild(_document.createTextNode(result));
        }
    }
    this.aggregated = true;
};

/**
 * Clears all the aggregations
 *
 * @alias Autodesk.Viewing.UI.DataTable#clearAggregates
 */
DataTable.prototype.clearAggregates = function() {
    var aggregates = this.datatableDiv.querySelectorAll('.aggregate-headers');
    for (var i = 0; i< aggregates.length; i++) {
        aggregates[i].parentNode.removeChild(aggregates[i]);
    }
};

/**
 * Makes header columns width equal to content columns
 *
 * @private
 */
DataTable.prototype._fitHeaderColumns = function() {
    var content = this.datatableDiv.querySelector('.clusterize-content');
    var headers = this.datatableDiv.querySelector('#headersArea');
    var firstRow = content.querySelector('tr:not(.clusterize-extra-row):not(.first)');
    if(!firstRow) {
        return;
    }
    var prevWidth = [];
    var columnsWidth = [];

    for(var i=0; i< firstRow.children.length; i++) {
        columnsWidth.push(firstRow.children[i].clientWidth);
    }
    if (columnsWidth.toString() == prevWidth.toString()) return;
    var tRow = headers.querySelector('tr');
    for(var j=0; j< tRow.children.length; j++) {
        tRow.children[j].style.setProperty('clientWidth', columnsWidth[j] + 'px', 'important');
        tRow.children[j].style.setProperty('min-width', columnsWidth[j] + 'px', 'important');
    }

    if(this.aggregated) {
        var aggregatedTable = this.datatableDiv.querySelector('#aggregateArea');
        for(var k=0; k< aggregatedTable.rows.length; k++) {
            var aggRow = aggregatedTable.rows[k];
            for(var p=0; p< aggRow.children.length; p++) {
                aggRow.children[p].style.setProperty('clientWidth', columnsWidth[p] + 'px', 'important');
                aggRow.children[p].style.setProperty('min-width', columnsWidth[p] + 'px', 'important');
            }
        }
    }
    prevWidth = columnsWidth;
};

/**
 * Make header width equal to the tbody
 *
 * @private
 */
DataTable.prototype._syncHeaderWidth = function() {
  var content = this.datatableDiv.querySelector('.clusterize-content');
  var headers = this.datatableDiv.querySelector('#headersArea');
  headers.style.setProperty('clientWidth', content.width);
  headers.style.setProperty('min-idth', content.width);
};